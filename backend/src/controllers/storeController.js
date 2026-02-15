'use strict';

const provisionerService = require('../services/provisionerService');

/**
 * Store Controller — handles HTTP request/response for store operations.
 * This layer is intentionally thin — all business logic lives in the provisioner service.
 * The controller's job: validate → call service → format response.
 */

/**
 * POST /api/v1/stores
 * Create a new store.
 */
async function createStore(req, res, next) {
  try {
    const { name, engine, theme, password } = req.body;
    // Owner is ALWAYS derived from the authenticated user — never from client input
    const ownerId = req.user.id;

    const store = await provisionerService.createStore({ name, engine, ownerId, theme, tenantPassword: password, correlationId: req.requestId });

    res.status(202).json({
      requestId: req.requestId,
      message: 'Store creation initiated. Provisioning is in progress.',
      store: formatStoreResponse(store, req.user),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/stores
 * List stores with optional filters.
 */
async function listStores(req, res, next) {
  try {
    const { status, engine, limit, offset } = req.query;
    const isAdmin = req.user.role === 'admin';

    const result = await provisionerService.listStores({
      status,
      engine,
      // Tenants ALWAYS scoped to their own stores; admins can optionally filter by ownerId
      ownerId: isAdmin ? req.query.ownerId : req.user.id,
      limit: parseInt(limit, 10) || 50,
      offset: parseInt(offset, 10) || 0,
    });

    res.json({
      requestId: req.requestId,
      stores: result.stores.map(s => formatStoreResponse(s, req.user)),
      total: result.total,
      limit: parseInt(limit, 10) || 50,
      offset: parseInt(offset, 10) || 0,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/stores/:id
 * Get a single store by ID.
 */
async function getStore(req, res, next) {
  try {
    const store = await provisionerService.getStore(req.params.id);

    // Tenants can only view their own stores
    if (req.user.role !== 'admin' && store.ownerId !== req.user.id) {
      return res.status(403).json({
        requestId: req.requestId,
        error: { code: 'FORBIDDEN', message: 'Access denied.', retryable: false },
      });
    }

    res.json({
      requestId: req.requestId,
      store: formatStoreResponse(store, req.user),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/v1/stores/:id
 * Delete a store (async — returns 202).
 */
async function deleteStore(req, res, next) {
  try {
    // Verify ownership first
    const existing = await provisionerService.getStore(req.params.id);
    if (req.user.role !== 'admin' && existing.ownerId !== req.user.id) {
      return res.status(403).json({
        requestId: req.requestId,
        error: { code: 'FORBIDDEN', message: 'Access denied.', retryable: false },
      });
    }

    const store = await provisionerService.deleteStore(req.params.id);

    res.status(202).json({
      requestId: req.requestId,
      message: 'Store deletion initiated.',
      store: formatStoreResponse(store, req.user),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/stores/:id/retry
 * Retry a failed store provisioning.
 */
async function retryStore(req, res, next) {
  try {
    const existing = await provisionerService.getStore(req.params.id);
    if (req.user.role !== 'admin' && existing.ownerId !== req.user.id) {
      return res.status(403).json({
        requestId: req.requestId,
        error: { code: 'FORBIDDEN', message: 'Access denied.', retryable: false },
      });
    }

    const store = await provisionerService.retryStore(req.params.id);

    res.status(202).json({
      requestId: req.requestId,
      message: 'Store retry initiated. Provisioning will restart.',
      store: formatStoreResponse(store, req.user),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/stores/:id/logs
 * Get activity logs for a store.
 */
async function getStoreLogs(req, res, next) {
  try {
    // Verify ownership before returning logs
    const store = await provisionerService.getStore(req.params.id);
    if (req.user.role !== 'admin' && store.ownerId !== req.user.id) {
      return res.status(403).json({
        requestId: req.requestId,
        error: { code: 'FORBIDDEN', message: 'Access denied.', retryable: false },
      });
    }

    const { limit, offset } = req.query;
    const result = await provisionerService.getStoreLogs(req.params.id, {
      limit: parseInt(limit, 10) || 100,
      offset: parseInt(offset, 10) || 0,
    });

    res.json({
      requestId: req.requestId,
      storeId: req.params.id,
      logs: result.logs,
      total: result.total,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Format a store record for API response.
 * Strips internal fields, structures URLs, adds computed fields.
 * Admin credentials are only visible to the store owner — platform admins
 * see masked values to protect tenant security.
 * @param {Object} store
 * @param {Object} [requestingUser] - The authenticated user making the request
 * @returns {Object}
 */
function formatStoreResponse(store, requestingUser) {
  const isOwner = requestingUser && store.ownerId === requestingUser.id;

  // Mask credentials for non-owners (platform admins should not see tenant passwords)
  let adminCredentials = null;
  if (store.adminCredentials) {
    if (isOwner) {
      // Owner sees full credentials
      adminCredentials = store.adminCredentials;
    } else {
      // Non-owner (platform admin) sees masked credentials
      adminCredentials = {
        ...store.adminCredentials,
        password: store.adminCredentials.password ? '••••••••' : null,
        email: store.adminCredentials.email
          ? store.adminCredentials.email.replace(/^(.{2}).+(@.+)$/, '$1****$2')
          : null,
      };
    }
  }

  return {
    id: store.id,
    name: store.name,
    engine: store.engine,
    status: store.status,
    theme: store.theme || null,
    urls: {
      storefront: store.storefrontUrl || null,
      admin: store.adminUrl || null,
    },
    namespace: store.namespace,
    adminCredentials,
    isCredentialOwner: isOwner,
    failureReason: store.failureReason || null,
    retryCount: store.retryCount,
    provisioningDurationMs: store.provisioningDurationMs || null,
    createdAt: store.createdAt,
    updatedAt: store.updatedAt,
  };
}

module.exports = {
  createStore,
  listStores,
  getStore,
  deleteStore,
  retryStore,
  getStoreLogs,
};
