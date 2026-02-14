'use strict';

const config = require('../config');
const storeRegistry = require('../services/storeRegistry');
const { StoreLimitError, AppError } = require('../utils/errors');
const logger = require('../utils/logger').child('guardrails');

/**
 * Guardrails middleware — enforces platform safety limits.
 */

// In-memory cooldown tracker: userId → last store creation timestamp
const cooldownMap = new Map();
const COOLDOWN_MS = process.env.STORE_CREATION_COOLDOWN_MS !== undefined
  ? parseInt(process.env.STORE_CREATION_COOLDOWN_MS, 10)
  : 300000; // 5 minutes (production-grade cooldown)

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
 * Enforce store creation cooldown per user.
 * Prevents rapid-fire store provisioning.
 */
function enforceCreationCooldown(req, res, next) {
  const userId = req.user?.id;
  if (!userId) return next();

  // Admins bypass cooldown
  if (req.user?.role === 'admin') return next();

  const lastCreation = cooldownMap.get(userId);
  const now = Date.now();

  if (lastCreation && (now - lastCreation) < COOLDOWN_MS) {
    const remainingMs = COOLDOWN_MS - (now - lastCreation);
    const remainingSec = Math.ceil(remainingMs / 1000);
    logger.warn('Store creation cooldown active', {
      userId,
      remainingSec,
    });
    return next(new AppError(
      `Please wait ${remainingSec} seconds before creating another store.`,
      {
        statusCode: 429,
        code: 'CREATION_COOLDOWN',
        suggestion: `Wait ${remainingSec} seconds before retrying.`,
        retryable: true,
      }
    ));
  }

  // Record this creation attempt (will be set after successful validation)
  // We set it here proactively — provisionerService will handle the actual creation
  cooldownMap.set(userId, now);

  // Clean up old entries periodically (prevent memory leak)
  if (cooldownMap.size > 10000) {
    const cutoff = now - COOLDOWN_MS * 2;
    for (const [uid, ts] of cooldownMap) {
      if (ts < cutoff) cooldownMap.delete(uid);
    }
  }

  next();
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
  enforceCreationCooldown,
  validateEngine,
};
