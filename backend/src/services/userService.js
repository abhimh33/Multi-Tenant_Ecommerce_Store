'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/pool');
const config = require('../config');
const logger = require('../utils/logger').child('user-service');

const SALT_ROUNDS = 12;

const USER_COLUMNS = `id, email, username, role, is_active, created_at, updated_at`;

// ─── Registration ────────────────────────────────────────────────────────────

async function register({ email, username, password, role = 'tenant' }) {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const result = await db.query(
    `INSERT INTO users (email, username, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING ${USER_COLUMNS}`,
    [email.toLowerCase().trim(), username.trim(), passwordHash, role]
  );

  logger.info('User registered', { userId: result.rows[0].id, email, role });
  return normalizeUser(result.rows[0]);
}

// ─── Authentication ──────────────────────────────────────────────────────────

async function authenticate({ email, password }) {
  const result = await db.query(
    `SELECT id, email, username, password_hash, role, is_active, created_at, updated_at
     FROM users WHERE email = $1`,
    [email.toLowerCase().trim()]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const user = result.rows[0];

  if (!user.is_active) {
    return null;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return null;
  }

  return normalizeUser(user);
}

// ─── JWT ─────────────────────────────────────────────────────────────────────

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

function verifyToken(token) {
  return jwt.verify(token, config.jwt.secret);
}

// ─── Queries ─────────────────────────────────────────────────────────────────

async function findById(id) {
  const result = await db.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
    [id]
  );
  return result.rows[0] ? normalizeUser(result.rows[0]) : null;
}

async function findByEmail(email) {
  const result = await db.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE email = $1`,
    [email.toLowerCase().trim()]
  );
  return result.rows[0] ? normalizeUser(result.rows[0]) : null;
}

async function countUsers() {
  const result = await db.query('SELECT COUNT(*) as count FROM users');
  return parseInt(result.rows[0].count, 10);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  register,
  authenticate,
  generateToken,
  verifyToken,
  findById,
  findByEmail,
  countUsers,
};
