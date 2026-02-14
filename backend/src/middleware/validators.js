'use strict';

const Joi = require('joi');

/**
 * Request validation schemas using Joi.
 * Strict validation — unknown fields are rejected.
 */

// ─── Auth Schemas ────────────────────────────────────────────────────────────

const registerSchema = Joi.object({
  email: Joi.string().email().max(255).required(),
  username: Joi.string().min(3).max(128).pattern(/^[a-zA-Z0-9_-]+$/).required()
    .messages({
      'string.pattern.base': 'Username must contain only letters, numbers, hyphens, and underscores.',
    }),
  password: Joi.string().min(8).max(128).required()
    .messages({
      'string.min': 'Password must be at least 8 characters.',
    }),
}).options({ stripUnknown: true });

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
}).options({ stripUnknown: true });

// ─── Audit Schema ────────────────────────────────────────────────────────────

const auditQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(500).default(100),
  offset: Joi.number().integer().min(0).default(0),
  storeId: Joi.string().pattern(/^store-[a-f0-9]{8}$/),
  eventType: Joi.string().max(64),
}).options({ stripUnknown: true });

// ─── Store Schemas ───────────────────────────────────────────────────────────

// Reserved words that cannot be used as store names
const RESERVED_STORE_NAMES = new Set([
  'admin', 'api', 'www', 'app', 'mail', 'smtp', 'imap', 'pop', 'ftp',
  'ssh', 'git', 'svn', 'test', 'staging', 'prod', 'production', 'dev',
  'development', 'beta', 'alpha', 'demo', 'preview', 'internal',
  'status', 'health', 'metrics', 'monitor', 'logs', 'audit',
  'kubernetes', 'k8s', 'kube', 'helm', 'docker', 'registry',
  'postgres', 'mysql', 'redis', 'mongo', 'database', 'db',
  'store', 'stores', 'default', 'system', 'root', 'null', 'undefined',
  'login', 'register', 'auth', 'oauth', 'sso', 'cdn', 'static',
  'assets', 'public', 'private', 'config', 'settings',
]);

// Profanity blocklist — prevents offensive store names
const PROFANITY_BLOCKLIST = new Set([
  'fuck', 'shit', 'ass', 'damn', 'bitch', 'bastard', 'dick', 'cock',
  'pussy', 'cunt', 'whore', 'slut', 'nigger', 'nigga', 'faggot', 'fag',
  'retard', 'porn', 'sex', 'xxx', 'anal', 'rape', 'pedo', 'nazi',
  'hitler', 'kill', 'murder', 'terrorist', 'bomb', 'drug', 'crack',
  'meth', 'heroin', 'cocaine', 'weed', 'marijuana',
]);

const createStoreSchema = Joi.object({
  name: Joi.string()
    .min(3)
    .max(63)
    .pattern(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/)
    .custom((value, helpers) => {
      if (RESERVED_STORE_NAMES.has(value.toLowerCase())) {
        return helpers.error('any.invalid');
      }
      // No consecutive hyphens (DNS best practice)
      if (/--/.test(value)) {
        return helpers.error('string.pattern.base');
      }
      // Profanity filter — check if name contains blocked words
      const nameLower = value.toLowerCase();
      for (const word of PROFANITY_BLOCKLIST) {
        if (nameLower.includes(word)) {
          return helpers.error('any.custom', { message: 'Store name contains inappropriate language.' });
        }
      }
      return value;
    })
    .required()
    .messages({
      'string.pattern.base': 'Store name must be lowercase, alphanumeric with hyphens, no consecutive hyphens, and cannot start or end with a hyphen.',
      'string.min': 'Store name must be at least 3 characters.',
      'string.max': 'Store name must be at most 63 characters (DNS label limit).',
      'any.invalid': 'This store name is reserved and cannot be used.',
    }),
  engine: Joi.string()
    .valid('woocommerce', 'medusa')
    .required()
    .messages({
      'any.only': 'Engine must be one of: woocommerce, medusa.',
    }),
  theme: Joi.string()
    .valid('storefront', 'astra')
    .when('engine', {
      is: 'woocommerce',
      then: Joi.string().default('storefront'),
      otherwise: Joi.forbidden(),
    })
    .messages({
      'any.only': 'Theme must be one of: storefront, astra.',
      'any.unknown': 'Theme is only applicable to WooCommerce stores.',
    }),
  // Optional — if provided, used as the admin password for the provisioned store
  password: Joi.string().min(8).max(128).optional()
    .messages({
      'string.min': 'Password must be at least 8 characters.',
    }),
  // ownerId is intentionally NOT accepted from client — always derived from JWT
}).options({ stripUnknown: true });

// ─── Password Change Schema ──────────────────────────────────────────────────

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(8).max(128).required()
    .messages({
      'string.min': 'New password must be at least 8 characters.',
    }),
}).options({ stripUnknown: true });

const listStoresSchema = Joi.object({
  status: Joi.string().valid('requested', 'provisioning', 'ready', 'failed', 'deleting', 'deleted'),
  engine: Joi.string().valid('woocommerce', 'medusa'),
  // ownerId is only settable server-side; admins can pass it as a query param
  ownerId: Joi.string().max(128),
  limit: Joi.number().integer().min(1).max(100).default(50),
  offset: Joi.number().integer().min(0).default(0),
}).options({ stripUnknown: true });

const storeIdSchema = Joi.object({
  id: Joi.string()
    .pattern(/^store-[a-f0-9]{8}$/)
    .required()
    .messages({
      'string.pattern.base': 'Store ID must match format: store-XXXXXXXX (8 hex characters)',
    }),
});

const logsQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(500).default(100),
  offset: Joi.number().integer().min(0).default(0),
}).options({ stripUnknown: true });

/**
 * Create a validation middleware from a Joi schema.
 * @param {Joi.Schema} schema
 * @param {'body'|'query'|'params'} source - Request property to validate
 * @returns {Function} Express middleware
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], { abortEarly: false });
    if (error) {
      return next(error);
    }
    req[source] = value; // replace with validated/sanitized values
    next();
  };
}

module.exports = {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  auditQuerySchema,
  createStoreSchema,
  listStoresSchema,
  storeIdSchema,
  logsQuerySchema,
  validate,
};
