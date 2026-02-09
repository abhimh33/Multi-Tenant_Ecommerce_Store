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

module.exports = { loginLimiter, registerLimiter };
