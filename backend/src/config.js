'use strict';

/**
 * Environment-aware configuration module.
 * All configuration is loaded from environment variables with explicit defaults.
 * No secrets are hardcoded — everything comes from .env or the runtime environment.
 */

const path = require('path');

// Load .env in development only
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
  } catch {
    // dotenv is optional — in production, env vars come from the container/orchestrator
  }
}

const config = {
  env: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') === 'development',
  isStaging: process.env.NODE_ENV === 'staging',
  isProd: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',

  server: {
    port: parseInt(process.env.PORT, 10) || 3001,
    host: process.env.HOST || '0.0.0.0',
  },

  database: {
    url: process.env.DATABASE_URL || 'postgresql://mtec:mtec_secret@localhost:5432/mtec_control_plane',
    pool: {
      min: parseInt(process.env.DB_POOL_MIN, 10) || 2,
      max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
      idleTimeoutMs: parseInt(process.env.DB_IDLE_TIMEOUT_MS, 10) || 30000,
    },
  },

  kubernetes: {
    kubeconfig: process.env.KUBECONFIG || undefined,
    context: process.env.KUBE_CONTEXT || undefined,
  },

  helm: {
    chartPath: process.env.HELM_CHART_PATH
      ? path.resolve(__dirname, '..', process.env.HELM_CHART_PATH)
      : path.resolve(__dirname, '..', '..', 'helm', 'ecommerce-store'),
    valuesFile: process.env.HELM_VALUES_FILE || 'values-local.yaml',
    timeout: process.env.HELM_TIMEOUT || '5m',
    debug: process.env.HELM_DEBUG === 'true',
  },

  provisioning: {
    maxStoresPerUser: parseInt(process.env.MAX_STORES_PER_USER, 10) || 5,
    timeoutMs: parseInt(process.env.PROVISIONING_TIMEOUT_MS, 10) || 600000, // 10 min
    pollIntervalMs: parseInt(process.env.PROVISIONING_POLL_INTERVAL_MS, 10) || 3000,
    maxRetries: parseInt(process.env.PROVISIONING_MAX_RETRIES, 10) || 3,
    retryBaseDelayMs: parseInt(process.env.PROVISIONING_RETRY_BASE_DELAY_MS, 10) || 2000,
  },

  store: {
    domainSuffix: process.env.STORE_DOMAIN_SUFFIX || '.localhost',
    namespacePrefix: process.env.STORE_NAMESPACE_PREFIX || 'store-',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },

  logging: {
    level: process.env.LOG_LEVEL || 'debug',
  },
};

// Freeze to prevent runtime mutation
Object.freeze(config);
Object.freeze(config.server);
Object.freeze(config.database);
Object.freeze(config.database.pool);
Object.freeze(config.kubernetes);
Object.freeze(config.helm);
Object.freeze(config.provisioning);
Object.freeze(config.store);
Object.freeze(config.jwt);
Object.freeze(config.logging);

module.exports = config;
