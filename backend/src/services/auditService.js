'use strict';

const db = require('../db/pool');
const logger = require('../utils/logger').child('audit');

/**
 * Audit Logger — append-only event log for store lifecycle events.
 * Every state transition, helm operation, error, and significant event is recorded.
 * This is the single source of truth for "what happened and when" for any store.
 */

/**
 * Log an audit event.
 * @param {Object} event
 * @param {string} [event.storeId] - Store this event belongs to (null for system events)
 * @param {string} event.eventType - Category: status_change | helm_install | helm_uninstall | error | info | security
 * @param {string} [event.previousStatus] - Status before transition
 * @param {string} [event.newStatus] - Status after transition
 * @param {string} [event.message] - Human-readable description
 * @param {Object} [event.metadata] - Structured extra data
 * @param {string} [event.ipAddress] - Client IP (for security events)
 * @param {string} [event.userEmail] - User email (for security events)
 */
async function log(event) {
  const { storeId, eventType, previousStatus, newStatus, message, metadata = {}, ipAddress, userEmail } = event;
  try {
    await db.query(
      `INSERT INTO audit_logs (store_id, event_type, previous_status, new_status, message, metadata, ip_address, user_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [storeId || null, eventType, previousStatus || null, newStatus || null, message || null, JSON.stringify(metadata), ipAddress || null, userEmail || null]
    );
    logger.debug('Audit event recorded', { storeId, eventType, message });
  } catch (err) {
    // Audit logging should never crash the main flow
    logger.error('Failed to record audit event', { storeId, eventType, error: err.message });
  }
}

/**
 * Get audit logs for a specific store.
 * @param {string} storeId
 * @param {Object} [options]
 * @param {number} [options.limit=100]
 * @param {number} [options.offset=0]
 * @returns {Promise<{ logs: Object[], total: number }>}
 */
async function getByStoreId(storeId, options = {}) {
  const { limit = 100, offset = 0 } = options;

  const countResult = await db.query(
    'SELECT COUNT(*) as total FROM audit_logs WHERE store_id = $1',
    [storeId]
  );

  const result = await db.query(
    `SELECT id, store_id, event_type, previous_status, new_status, message, metadata, created_at
     FROM audit_logs
     WHERE store_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [storeId, limit, offset]
  );

  return {
    logs: result.rows.map(normalizeAuditRow),
    total: parseInt(countResult.rows[0].total, 10),
  };
}

/**
 * Log a security event (login, lockout, rate limit, registration).
 * These events have no storeId but include IP and email context.
 * 
 * @param {Object} event
 * @param {string} event.action - login_success | login_failed | account_locked | rate_limited | registration
 * @param {string} [event.email] - User email involved
 * @param {string} [event.ip] - Client IP address
 * @param {string} [event.message] - Human-readable description
 * @param {Object} [event.metadata] - Extra structured data
 */
async function logSecurityEvent({ action, email, ip, message, metadata = {} }) {
  return log({
    storeId: null,
    eventType: 'security',
    message: message || `Security event: ${action}`,
    metadata: { action, ...metadata },
    ipAddress: ip,
    userEmail: email,
  });
}

/**
 * List all audit logs with optional filters (for global audit page).
 * Admin sees all; tenants are filtered by ownerId (joined via stores table).
 * Security events (null store_id) are visible to admins only.
 */
async function listAll(filters = {}) {
  const { ownerId, storeId, eventType, limit = 100, offset = 0 } = filters;
  const conditions = [];
  const params = [];
  let idx = 1;

  if (ownerId) {
    // Tenants see only their own store events (exclude system security events)
    conditions.push(`s.owner_id = $${idx++}`);
    params.push(ownerId);
  }

  if (storeId) {
    conditions.push(`a.store_id = $${idx++}`);
    params.push(storeId);
  }

  if (eventType) {
    conditions.push(`a.event_type = $${idx++}`);
    params.push(eventType);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Use LEFT JOIN so security events (null store_id) appear for admins
  const joinType = ownerId ? 'JOIN' : 'LEFT JOIN';

  const countResult = await db.query(
    `SELECT COUNT(*) as total FROM audit_logs a ${joinType} stores s ON a.store_id = s.id ${whereClause}`,
    params
  );

  const result = await db.query(
    `SELECT a.id, a.store_id, a.event_type, a.previous_status, a.new_status,
            a.message, a.metadata, a.created_at, a.ip_address, a.user_email,
            s.name as store_name
     FROM audit_logs a
     ${joinType} stores s ON a.store_id = s.id
     ${whereClause}
     ORDER BY a.created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset]
  );

  return {
    logs: result.rows.map(row => ({
      ...normalizeAuditRow(row),
      storeName: row.store_name || null,
    })),
    total: parseInt(countResult.rows[0].total, 10),
  };
}

function normalizeAuditRow(row) {
  return {
    id: row.id,
    storeId: row.store_id || null,
    eventType: row.event_type,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    message: row.message,
    metadata: row.metadata,
    ipAddress: row.ip_address || null,
    userEmail: row.user_email || null,
    createdAt: row.created_at,
  };
}

module.exports = {
  log,
  logSecurityEvent,
  getByStoreId,
  listAll,
};
