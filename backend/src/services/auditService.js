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
 * @param {string} event.storeId - Store this event belongs to
 * @param {string} event.eventType - Category: status_change | helm_install | helm_uninstall | error | info
 * @param {string} [event.previousStatus] - Status before transition
 * @param {string} [event.newStatus] - Status after transition
 * @param {string} [event.message] - Human-readable description
 * @param {Object} [event.metadata] - Structured extra data
 */
async function log(event) {
  const { storeId, eventType, previousStatus, newStatus, message, metadata = {} } = event;
  try {
    await db.query(
      `INSERT INTO audit_logs (store_id, event_type, previous_status, new_status, message, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [storeId, eventType, previousStatus || null, newStatus || null, message || null, JSON.stringify(metadata)]
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

function normalizeAuditRow(row) {
  return {
    id: row.id,
    storeId: row.store_id,
    eventType: row.event_type,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    message: row.message,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

module.exports = {
  log,
  getByStoreId,
};
