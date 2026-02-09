'use strict';

/**
 * Database migration runner.
 * Applies migrations in order, tracks applied migrations in a _migrations table.
 * Idempotent — safe to run multiple times.
 * 
 * Usage: node src/db/migrate.js
 */

const path = require('path');
const fs = require('fs');
const { pool } = require('./pool');
const logger = require('../utils/logger').child('migration');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations() {
  const result = await pool.query('SELECT name FROM _migrations ORDER BY id');
  return new Set(result.rows.map(r => r.name));
}

async function runMigrations() {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      logger.debug(`Migration already applied: ${file}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      logger.info(`Migration applied: ${file}`);
      count++;
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`Migration failed: ${file}`, { error: err.message });
      throw err;
    } finally {
      client.release();
    }
  }

  if (count === 0) {
    logger.info('All migrations already applied');
  } else {
    logger.info(`Applied ${count} migration(s)`);
  }
}

// Run directly if called as a script
if (require.main === module) {
  runMigrations()
    .then(() => {
      logger.info('Migration complete');
      process.exit(0);
    })
    .catch((err) => {
      logger.error('Migration failed', { error: err.message });
      process.exit(1);
    });
}

module.exports = { runMigrations };
