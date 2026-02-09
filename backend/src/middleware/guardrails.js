'use strict';

const config = require('../config');
const storeRegistry = require('../services/storeRegistry');
const { StoreLimitError } = require('../utils/errors');
const logger = require('../utils/logger').child('guardrails');

/**
 * Guardrails middleware — enforces platform safety limits.
 */

/**
 * Enforce per-user store creation limit.
 * Checks the count of active (non-deleted, non-failed) stores for the owner.
 * Applied before store creation.
 */
async function enforceStoreLimit(req, res, next) {
  try {
    // Always use the authenticated user's ID — never trust client input
    const ownerId = req.user?.id || 'default';
    const activeCount = await storeRegistry.countActiveByOwner(ownerId);

    if (activeCount >= config.provisioning.maxStoresPerUser) {
      logger.warn('Store limit exceeded', {
        ownerId,
        activeCount,
        limit: config.provisioning.maxStoresPerUser,
      });
      throw new StoreLimitError(config.provisioning.maxStoresPerUser);
    }

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Validate that the requested engine is supported.
 */
function validateEngine(req, res, next) {
  const supportedEngines = ['woocommerce', 'medusa'];
  const engine = req.body.engine;

  if (engine && !supportedEngines.includes(engine)) {
    return res.status(400).json({
      requestId: req.requestId,
      error: {
        code: 'UNSUPPORTED_ENGINE',
        message: `Engine '${engine}' is not supported. Supported engines: ${supportedEngines.join(', ')}`,
        suggestion: 'Use one of the supported engines.',
        retryable: false,
      },
    });
  }

  next();
}

module.exports = {
  enforceStoreLimit,
  validateEngine,
};
