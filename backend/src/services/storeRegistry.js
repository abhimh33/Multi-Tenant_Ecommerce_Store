'use strict';

const db = require('../db/pool');
const logger = require('../utils/logger').child('store-registry');

/**
 * Store Registry — data access layer for the stores table.
 * All database interactions for store CRUD go through this module.
 * No business logic here — pure data access with parameterized queries.
 */

const STORE_COLUMNS = `
  id, name, engine, status, namespace, helm_release,
  storefront_url, admin_url, failure_reason, retry_count,
  provisioning_started_at, provisioning_completed_at, provisioning_duration_ms,
  owner_id, created_at, updated_at, deleted_at
`;

/**
 * Insert a new store record.
 * @param {Object} store
 * @returns {Promise<Object>} The created store row
 */
async function create(store) {
  const { id, name, engine, namespace, helmRelease, ownerId = 'default' } = store;
  const result = await db.query(
    `INSERT INTO stores (id, name, engine, namespace, helm_release, owner_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${STORE_COLUMNS}`,
    [id, name, engine, namespace, helmRelease, ownerId]
  );
  logger.info('Store record created', { storeId: id, engine });
  return normalizeRow(result.rows[0]);
}

/**
 * Find a store by ID.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
async function findById(id) {
  const result = await db.query(
    `SELECT ${STORE_COLUMNS} FROM stores WHERE id = $1`,
    [id]
  );
  return result.rows[0] ? normalizeRow(result.rows[0]) : null;
}

/**
 * Find a store by name and owner.
 * Used for idempotency checks — prevents duplicate store names per owner.
 * @param {string} name
 * @param {string} ownerId
 * @returns {Promise<Object|null>}
 */
async function findByNameAndOwner(name, ownerId = 'default') {
  const result = await db.query(
    `SELECT ${STORE_COLUMNS} FROM stores WHERE name = $1 AND owner_id = $2 AND status != 'deleted'`,
    [name, ownerId]
  );
  return result.rows[0] ? normalizeRow(result.rows[0]) : null;
}

/**
 * List all stores, with optional filters.
 * @param {Object} [filters]
 * @param {string} [filters.ownerId]
 * @param {string} [filters.status]
 * @param {string} [filters.engine]
 * @param {number} [filters.limit=50]
 * @param {number} [filters.offset=0]
 * @returns {Promise<{ stores: Object[], total: number }>}
 */
async function list(filters = {}) {
  const { ownerId, status, engine, limit = 50, offset = 0 } = filters;
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  // Exclude deleted stores by default unless explicitly filtered
  if (status) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(status);
  } else {
    conditions.push(`status != 'deleted'`);
  }

  if (ownerId) {
    conditions.push(`owner_id = $${paramIndex++}`);
    params.push(ownerId);
  }

  if (engine) {
    conditions.push(`engine = $${paramIndex++}`);
    params.push(engine);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await db.query(
    `SELECT COUNT(*) as total FROM stores ${whereClause}`,
    params
  );

  const dataResult = await db.query(
    `SELECT ${STORE_COLUMNS} FROM stores ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...params, limit, offset]
  );

  return {
    stores: dataResult.rows.map(normalizeRow),
    total: parseInt(countResult.rows[0].total, 10),
  };
}

/**
 * Update store status and related fields.
 * @param {string} id
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated store row
 */
async function update(id, updates) {
  const setClauses = [];
  const params = [];
  let paramIndex = 1;

  const allowedFields = {
    status: 'status',
    storefrontUrl: 'storefront_url',
    adminUrl: 'admin_url',
    failureReason: 'failure_reason',
    retryCount: 'retry_count',
    provisioningStartedAt: 'provisioning_started_at',
    provisioningCompletedAt: 'provisioning_completed_at',
    provisioningDurationMs: 'provisioning_duration_ms',
    deletedAt: 'deleted_at',
    helmRelease: 'helm_release',
  };

  for (const [key, column] of Object.entries(allowedFields)) {
    if (updates[key] !== undefined) {
      setClauses.push(`${column} = $${paramIndex++}`);
      params.push(updates[key]);
    }
  }

  if (setClauses.length === 0) {
    return findById(id);
  }

  params.push(id);
  const result = await db.query(
    `UPDATE stores SET ${setClauses.join(', ')} WHERE id = $${paramIndex}
     RETURNING ${STORE_COLUMNS}`,
    params
  );

  if (result.rows.length === 0) {
    return null;
  }

  logger.info('Store record updated', { storeId: id, fields: Object.keys(updates) });
  return normalizeRow(result.rows[0]);
}

/**
 * Count active (non-deleted) stores for an owner.
 * Used for per-user store limit enforcement.
 * @param {string} ownerId
 * @returns {Promise<number>}
 */
async function countActiveByOwner(ownerId = 'default') {
  const result = await db.query(
    `SELECT COUNT(*) as count FROM stores WHERE owner_id = $1 AND status NOT IN ('deleted', 'failed')`,
    [ownerId]
  );
  return parseInt(result.rows[0].count, 10);
}

/**
 * Find stores stuck in a transitional state (for recovery on backend restart).
 * @returns {Promise<Object[]>}
 */
async function findStuckStores() {
  const result = await db.query(
    `SELECT ${STORE_COLUMNS} FROM stores WHERE status IN ('requested', 'provisioning', 'deleting')
     ORDER BY created_at ASC`
  );
  return result.rows.map(normalizeRow);
}

/**
 * Normalize a database row to a camelCase JS object.
 * Converts snake_case columns to camelCase properties.
 * @param {Object} row
 * @returns {Object}
 */
function normalizeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    engine: row.engine,
    status: row.status,
    namespace: row.namespace,
    helmRelease: row.helm_release,
    storefrontUrl: row.storefront_url,
    adminUrl: row.admin_url,
    failureReason: row.failure_reason,
    retryCount: row.retry_count,
    provisioningStartedAt: row.provisioning_started_at,
    provisioningCompletedAt: row.provisioning_completed_at,
    provisioningDurationMs: row.provisioning_duration_ms,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

module.exports = {
  create,
  findById,
  findByNameAndOwner,
  list,
  update,
  countActiveByOwner,
  findStuckStores,
};
