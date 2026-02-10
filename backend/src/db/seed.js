'use strict';

/**
 * Database seed script — creates initial data for testing.
 * Idempotent — safe to run multiple times.
 * 
 * Usage: node src/db/seed.js
 */

const bcrypt = require('bcryptjs');
const { pool } = require('./pool');
const logger = require('../utils/logger').child('seed');

const SALT_ROUNDS = 12;

const SEED_USERS = [
    {
        email: 'admin@example.com',
        username: 'admin',
        password: 'admin123!',
        role: 'admin',
    },
];

async function seed() {
    for (const user of SEED_USERS) {
        // Check if user already exists
        const existing = await pool.query(
            'SELECT id FROM users WHERE email = $1',
            [user.email]
        );

        if (existing.rows.length > 0) {
            logger.info(`Seed user already exists: ${user.email}`);
            continue;
        }

        const passwordHash = await bcrypt.hash(user.password, SALT_ROUNDS);
        await pool.query(
            `INSERT INTO users (email, username, password_hash, role)
       VALUES ($1, $2, $3, $4)`,
            [user.email, user.username, passwordHash, user.role]
        );
        logger.info(`Seeded user: ${user.email} (${user.role})`);
    }
}

if (require.main === module) {
    seed()
        .then(() => {
            logger.info('Seed complete');
            process.exit(0);
        })
        .catch((err) => {
            logger.error('Seed failed', { error: err.message });
            process.exit(1);
        });
}

module.exports = { seed };
