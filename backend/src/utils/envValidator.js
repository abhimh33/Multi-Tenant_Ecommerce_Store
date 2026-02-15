'use strict';

const Joi = require('joi');

/**
 * Environment Variable Validator
 * Validates all required and optional env vars at startup.
 * Fails fast with clear error messages if critical vars are missing.
 */

const envSchema = Joi.object({
  // ─── Server ────────────────────────────────────────────────────────────
  NODE_ENV: Joi.string()
    .valid('development', 'staging', 'production', 'test')
    .default('development'),
  PORT: Joi.number().integer().min(1).max(65535).default(3001),
  HOST: Joi.string().default('0.0.0.0'),

  // ─── Database ──────────────────────────────────────────────────────────
  DATABASE_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] })
    .default('postgresql://mtec:mtec_secret@localhost:5432/mtec_control_plane'),
  DB_POOL_MIN: Joi.number().integer().min(0).max(100).default(2),
  DB_POOL_MAX: Joi.number().integer().min(1).max(100).default(10),
  DB_IDLE_TIMEOUT_MS: Joi.number().integer().min(0).default(30000),

  // ─── JWT ───────────────────────────────────────────────────────────────
  JWT_SECRET: Joi.string().min(16).default('dev-jwt-secret-change-in-production')
    .messages({
      'string.min': 'JWT_SECRET must be at least 16 characters for security.',
    }),
  JWT_EXPIRES_IN: Joi.string().default('24h'),

  // ─── Kubernetes ────────────────────────────────────────────────────────
  KUBECONFIG: Joi.string().optional(),
  KUBE_CONTEXT: Joi.string().optional(),

  // ─── Helm ──────────────────────────────────────────────────────────────
  HELM_BIN: Joi.string().default('helm'),
  HELM_CHART_PATH: Joi.string().optional(),
  HELM_VALUES_FILE: Joi.string().default('values-local.yaml'),
  HELM_TIMEOUT: Joi.string().default('5m'),
  HELM_DEBUG: Joi.string().valid('true', 'false').default('false'),

  // ─── Provisioning ─────────────────────────────────────────────────────
  MAX_STORES_PER_USER: Joi.number().integer().min(1).max(100).default(5),
  PROVISIONING_TIMEOUT_MS: Joi.number().integer().min(10000).default(600000),
  PROVISIONING_POLL_INTERVAL_MS: Joi.number().integer().min(1000).default(5000),
  PROVISIONING_MAX_RETRIES: Joi.number().integer().min(0).max(10).default(3),
  PROVISIONING_RETRY_BASE_DELAY_MS: Joi.number().integer().min(100).default(2000),

  // ─── Store ─────────────────────────────────────────────────────────────
  STORE_DOMAIN_SUFFIX: Joi.string().default('.localhost'),
  STORE_NAMESPACE_PREFIX: Joi.string().default('store-'),

  // ─── CORS ──────────────────────────────────────────────────────────────
  CORS_ORIGIN: Joi.string().optional(),

  // ─── Logging ───────────────────────────────────────────────────────────
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly')
    .default('debug'),

  // ─── Rate Limiting ─────────────────────────────────────────────────────
  RATE_LIMIT_WINDOW_MS: Joi.number().integer().min(1000).default(60000),
  RATE_LIMIT_MAX: Joi.number().integer().min(1).default(60),
  LOGIN_RATE_LIMIT_WINDOW_MS: Joi.number().integer().min(1000).default(900000), // 15 min
  LOGIN_RATE_LIMIT_MAX: Joi.number().integer().min(1).default(10),

  // ─── Circuit Breaker ──────────────────────────────────────────────────
  CB_FAILURE_THRESHOLD: Joi.number().integer().min(1).default(5),
  CB_RESET_TIMEOUT_MS: Joi.number().integer().min(1000).default(30000),
  CB_HALF_OPEN_MAX: Joi.number().integer().min(1).default(2),

  // ─── Guardrails ───────────────────────────────────────────────────────
  STORE_CREATION_COOLDOWN_MS: Joi.number().integer().min(0).default(300000), // 5 min

  // ─── Account Lockout ──────────────────────────────────────────────────
  ACCOUNT_LOCKOUT_MAX_ATTEMPTS: Joi.number().integer().min(1).default(5),
  ACCOUNT_LOCKOUT_DURATION_MS: Joi.number().integer().min(1000).default(900000), // 15 min

  // ─── kubectl ──────────────────────────────────────────────────────────
  KUBECTL_BIN: Joi.string().default('kubectl'),

}).options({ allowUnknown: true, stripUnknown: false });

/**
 * Validate environment variables.
 * Call this at startup BEFORE loading config.
 * 
 * @param {Object} [env=process.env]
 * @returns {{ validated: Object, warnings: string[] }}
 * @throws {Error} If required variables are missing or invalid
 */
function validateEnv(env = process.env) {
  const { error, value } = envSchema.validate(env, {
    abortEarly: false,
  });

  const warnings = [];

  if (error) {
    const details = error.details.map(d => `  • ${d.message}`).join('\n');
    throw new Error(
      `Environment validation failed:\n${details}\n\n` +
      'Set the missing variables in .env or your environment.'
    );
  }

  // Production and staging hardening
  if (value.NODE_ENV === 'production' || value.NODE_ENV === 'staging') {
    if (value.JWT_SECRET === 'dev-jwt-secret-change-in-production') {
      throw new Error(
        'FATAL: JWT_SECRET must be set to a secure value in production/staging. ' +
        'The default development secret is not allowed.'
      );
    }
    if (!value.CORS_ORIGIN) {
      warnings.push('WARNING: CORS_ORIGIN not set in production — API is open to all origins.');
    }
    if (value.DATABASE_URL.includes('localhost')) {
      warnings.push('WARNING: DATABASE_URL points to localhost in production.');
    }
    if (value.LOG_LEVEL === 'debug' || value.LOG_LEVEL === 'silly') {
      warnings.push('WARNING: LOG_LEVEL is set to debug/silly in production — consider using info or warn.');
    }
  }

  return { validated: value, warnings };
}

module.exports = { validateEnv };
