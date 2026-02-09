'use strict';

const { Pool } = require('pg');
const config = require('../config');
const logger = require('../utils/logger').child('database');

/**
 * PostgreSQL connection pool.
 * Shared across the control plane — one pool per process.
 * Graceful shutdown is handled via pool.end() in the app lifecycle.
 */
const pool = new Pool({
  connectionString: config.database.url,
  min: config.database.pool.min,
  max: config.database.pool.max,
  idleTimeoutMillis: config.database.pool.idleTimeoutMs,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL pool error', { error: err.message });
});

pool.on('connect', () => {
  logger.debug('New PostgreSQL client connected');
});

/**
 * Execute a parameterized query against the pool.
 * @param {string} text - SQL query text with $1, $2, ... placeholders
 * @param {any[]} params - Query parameters
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const durationMs = Date.now() - start;
    logger.debug('Query executed', {
      query: text.substring(0, 100),
      rows: result.rowCount,
      durationMs,
    });
    return result;
  } catch (err) {
    logger.error('Query failed', { query: text.substring(0, 100), error: err.message });
    throw err;
  }
}

/**
 * Get a client from the pool for transaction support.
 * Caller MUST release the client via client.release().
 * @returns {Promise<import('pg').PoolClient>}
 */
async function getClient() {
  return pool.connect();
}

/**
 * Execute a callback inside a transaction.
 * Automatically commits on success, rolls back on error.
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Health check — verifies the database is reachable.
 * @returns {Promise<boolean>}
 */
async function healthCheck() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Gracefully close all pool connections.
 */
async function close() {
  logger.info('Closing PostgreSQL pool');
  await pool.end();
}

module.exports = {
  query,
  getClient,
  withTransaction,
  healthCheck,
  close,
  pool, // exposed for migration scripts
};
