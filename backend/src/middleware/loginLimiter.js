'use strict';

const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger').child('login-limiter');

/**
 * Brute-force login protection.
 * Limits login attempts per IP to prevent credential stuffing and brute-force attacks.
 * 
 * Defaults: 10 attempts per 15-minute window per IP.
 * After exhausting attempts, returns 429 with a clear retry-after message.
 */

// ─── Account Lockout ─────────────────────────────────────────────────────────
// Tracks consecutive failed login attempts per email.
// Locks account temporarily after MAX_FAILED_ATTEMPTS.

const MAX_FAILED_ATTEMPTS = parseInt(process.env.ACCOUNT_LOCKOUT_MAX_ATTEMPTS, 10) || 5;
const LOCKOUT_DURATION_MS = parseInt(process.env.ACCOUNT_LOCKOUT_DURATION_MS, 10) || 15 * 60 * 1000; // 15 min

// email → { failures: number, lockedUntil: number|null }
const accountLockouts = new Map();

/**
 * Record a failed login attempt. Locks account after MAX_FAILED_ATTEMPTS.
 * @param {string} email
 */
function recordFailedAttempt(email) {
  const key = email.toLowerCase().trim();
  const entry = accountLockouts.get(key) || { failures: 0, lockedUntil: null };
  entry.failures += 1;

  if (entry.failures >= MAX_FAILED_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
    logger.warn('Account temporarily locked due to repeated failed attempts', {
      email: key,
      failures: entry.failures,
      lockedUntilISO: new Date(entry.lockedUntil).toISOString(),
    });
  }

  accountLockouts.set(key, entry);

  // Periodic cleanup of old entries to prevent memory leak
  if (accountLockouts.size > 50000) {
    const now = Date.now();
    for (const [k, v] of accountLockouts) {
      if (!v.lockedUntil || v.lockedUntil < now) accountLockouts.delete(k);
    }
  }
}

/**
 * Clear lockout on successful login.
 * @param {string} email
 */
function clearLockout(email) {
  accountLockouts.delete(email.toLowerCase().trim());
}

/**
 * Middleware: check if the account is currently locked out.
 * Must be placed BEFORE the login handler.
 */
function checkAccountLockout(req, res, next) {
  const email = req.body?.email?.toLowerCase()?.trim();
  if (!email) return next();

  const entry = accountLockouts.get(email);
  if (entry && entry.lockedUntil) {
    const now = Date.now();
    if (now < entry.lockedUntil) {
      const remainingSec = Math.ceil((entry.lockedUntil - now) / 1000);
      logger.warn('Login blocked — account locked', { email, remainingSec });
      return res.status(423).json({
        requestId: req.requestId,
        error: {
          code: 'ACCOUNT_LOCKED',
          message: `Account temporarily locked due to too many failed attempts. Try again in ${Math.ceil(remainingSec / 60)} minutes.`,
          suggestion: 'Wait for the lockout period to expire, then try again with the correct credentials.',
          retryable: true,
          retryAfterSeconds: remainingSec,
        },
      });
    }
    // Lockout expired — clear it
    accountLockouts.delete(email);
  }
  next();
}

const loginLimiter = rateLimit({
  windowMs: parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX, 10) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  keyGenerator: (req) => {
    // Rate limit by IP + email combo to prevent locking out shared IPs
    const email = req.body?.email?.toLowerCase()?.trim() || 'unknown';
    return `${req.ip}:${email}`;
  },
  handler: (req, res) => {
    const retryAfterSeconds = Math.ceil(
      (parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, 10) || 900000) / 1000
    );

    logger.warn('Login rate limit exceeded', {
      ip: req.ip,
      email: req.body?.email,
      retryAfterSeconds,
    });

    res.status(429).json({
      requestId: req.requestId,
      error: {
        code: 'LOGIN_RATE_LIMITED',
        message: `Too many login attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minutes.`,
        suggestion: 'Wait before retrying. If you forgot your password, use the reset flow.',
        retryable: true,
        retryAfterSeconds,
      },
    });
  },
});

/**
 * Registration rate limiter — prevents bot spam registrations.
 * Limits: 3 registrations per IP per hour.
 */
const registerLimiter = rateLimit({
  windowMs: parseInt(process.env.REGISTER_RATE_LIMIT_WINDOW_MS, 10) || 60 * 60 * 1000, // 1 hour
  max: parseInt(process.env.REGISTER_RATE_LIMIT_MAX, 10) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => {
    logger.warn('Registration rate limit exceeded', { ip: req.ip });
    res.status(429).json({
      requestId: req.requestId,
      error: {
        code: 'REGISTRATION_RATE_LIMITED',
        message: 'Too many registration attempts. Try again later.',
        suggestion: 'Wait an hour before creating another account from this network.',
        retryable: true,
      },
    });
  },
});

module.exports = {
  loginLimiter,
  registerLimiter,
  checkAccountLockout,
  recordFailedAttempt,
  clearLockout,
};
