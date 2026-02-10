'use strict';

const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger').child('provisioner');
const storeRegistry = require('./storeRegistry');
const auditService = require('./auditService');
const helmService = require('./helmService');
const k8sService = require('./kubernetesService');
const { STATES, assertTransition, canDelete, canRetry } = require('../models/storeMachine');
const { generateStoreId, storeIdToNamespace, storeIdToHelmRelease } = require('../utils/idGenerator');
const { retryWithBackoff } = require('../utils/retry');
const storeSetupService = require('./storeSetupService');
const {
  NotFoundError,
  ConflictError,
  StoreLimitError,
  ProvisioningError,
} = require('../utils/errors');

/**
 * Provisioner Service — the central orchestrator for store lifecycle.
 * 
 * Coordinates between the store registry (state), Helm (deployment),
 * and Kubernetes (runtime) to manage the full lifecycle of tenant stores.
 * 
 * Design principles:
 * - Every operation is idempotent — safe to retry on partial failure.
 * - State transitions are explicit and atomic (DB → then side-effect).
 * - Async provisioning: create returns immediately, provisioning happens in background.
 * - All operations are audited.
 */

// In-progress provisioning operations — prevents concurrent provision of same store
const activeOperations = new Map();

/**
 * Create a new store.
 * Validates limits, creates DB record, then kicks off async provisioning.
 * 
 * @param {Object} params
 * @param {string} params.name - Store display name
 * @param {string} params.engine - Store engine (woocommerce|medusa)
 * @param {string} [params.ownerId='default'] - Owner for limit enforcement
 * @returns {Promise<Object>} Created store record
 */
async function createStore({ name, engine, ownerId = 'default' }) {
  // 1. Idempotency: check if store with this name already exists
  const existing = await storeRegistry.findByNameAndOwner(name, ownerId);
  if (existing) {
    if (existing.status === STATES.FAILED) {
      logger.info('Found existing failed store with same name, allowing re-creation', {
        storeId: existing.id,
        name,
      });
      // Mark old one as deleted first
      await storeRegistry.update(existing.id, {
        status: STATES.DELETED,
        deletedAt: new Date().toISOString(),
      });
    } else {
      throw new ConflictError(
        `A store named '${name}' already exists (status: ${existing.status}).`,
        'Use a different name or delete the existing store first.'
      );
    }
  }

  // 2. Enforce per-user store limit
  const activeCount = await storeRegistry.countActiveByOwner(ownerId);
  if (activeCount >= config.provisioning.maxStoresPerUser) {
    throw new StoreLimitError(config.provisioning.maxStoresPerUser);
  }

  // 3. Generate IDs
  const storeId = generateStoreId();
  const namespace = storeIdToNamespace(storeId);
  const helmRelease = storeIdToHelmRelease(storeId);

  // 4. Create DB record in 'requested' state
  const store = await storeRegistry.create({
    id: storeId,
    name,
    engine,
    namespace,
    helmRelease,
    ownerId,
  });

  await auditService.log({
    storeId,
    eventType: 'store_created',
    newStatus: STATES.REQUESTED,
    message: `Store '${name}' created with engine '${engine}'`,
    metadata: { engine, ownerId },
  });

  // 5. Kick off async provisioning (non-blocking)
  provisionStoreAsync(storeId).catch(err => {
    logger.error('Unhandled provisioning error', { storeId, error: err.message });
  });

  return store;
}

/**
 * Internal async provisioning workflow.
 * Runs in the background after createStore returns.
 * 
 * Steps:
 * 1. Transition to PROVISIONING
 * 2. Create K8s namespace
 * 3. Install Helm release
 * 4. Poll for readiness
 * 5. Extract URLs
 * 6. Transition to READY or FAILED
 */
async function provisionStoreAsync(storeId) {
  // Prevent concurrent provisioning of the same store
  if (activeOperations.has(storeId)) {
    logger.warn('Provisioning already in progress', { storeId });
    return;
  }
  activeOperations.set(storeId, Date.now());

  try {
    let store = await storeRegistry.findById(storeId);
    if (!store) throw new NotFoundError('Store', storeId);

    // Step 1: Transition to PROVISIONING
    assertTransition(store.status, STATES.PROVISIONING);
    store = await storeRegistry.update(storeId, {
      status: STATES.PROVISIONING,
      provisioningStartedAt: new Date().toISOString(),
      failureReason: null,
    });

    await auditService.log({
      storeId,
      eventType: 'status_change',
      previousStatus: STATES.REQUESTED,
      newStatus: STATES.PROVISIONING,
      message: 'Provisioning started',
    });

    // Step 2: Create namespace
    await auditService.log({
      storeId,
      eventType: 'info',
      message: 'Creating Kubernetes namespace',
      metadata: { namespace: store.namespace },
    });

    await retryWithBackoff(
      () => k8sService.createNamespace(store.namespace, {
        'mt-ecommerce/engine': store.engine,
        'mt-ecommerce/store-name': store.name,
      }),
      { maxRetries: 2, operationName: 'createNamespace' }
    );

    // Step 3: Install Helm chart
    await auditService.log({
      storeId,
      eventType: 'helm_install',
      message: `Installing Helm release '${store.helmRelease}'`,
      metadata: { engine: store.engine, namespace: store.namespace },
    });

    // Generate random credentials for this store (engine-aware)
    const adminPassword = crypto.randomBytes(12).toString('base64url');
    const dbPassword = crypto.randomBytes(16).toString('base64url');
    let credentials;
    let setValues;

    if (store.engine === 'woocommerce') {
      const dbRootPassword = crypto.randomBytes(16).toString('base64url');
      credentials = {
        adminUsername: 'admin',
        adminPassword,
        adminEmail: 'admin@example.com',
        dbPassword,
        dbRootPassword,
      };
      setValues = {
        'wordpress.admin.password': adminPassword,
        'wordpress.admin.username': 'admin',
        'wordpress.admin.email': 'admin@example.com',
        'mariadb.rootPassword': dbRootPassword,
        'mariadb.password': dbPassword,
      };
    } else if (store.engine === 'medusa') {
      const jwtSecret = crypto.randomBytes(32).toString('base64url');
      const cookieSecret = crypto.randomBytes(32).toString('base64url');
      credentials = {
        adminUsername: 'admin',
        adminPassword,
        adminEmail: 'admin@medusa.local',
        dbPassword,
        jwtSecret,
        cookieSecret,
      };
      setValues = {
        'medusa.admin.email': 'admin@medusa.local',
        'medusa.admin.password': adminPassword,
        'medusa.jwtSecret': jwtSecret,
        'medusa.cookieSecret': cookieSecret,
        'medusa.postgresql.password': dbPassword,
      };
    }

    await retryWithBackoff(
      () => helmService.install({
        releaseName: store.helmRelease,
        namespace: store.namespace,
        engine: store.engine,
        setValues,
      }),
      { maxRetries: 1, operationName: 'helmInstall' }
    );

    // Step 4: Poll for readiness
    await auditService.log({
      storeId,
      eventType: 'info',
      message: 'Waiting for pods to become ready',
    });

    const readiness = await k8sService.pollForReadiness(store.namespace, {
      onProgress: (status) => {
        logger.debug('Provisioning progress', {
          storeId,
          podsReady: `${status.podsReadyCount}/${status.podsTotal}`,
          jobsComplete: status.jobsComplete,
          elapsedMs: status.elapsedMs,
        });
      },
    });

    if (!readiness.ready) {
      const reason = readiness.timedOut
        ? `Provisioning timed out after ${Math.round(readiness.durationMs / 1000)}s`
        : readiness.error || 'Pods failed to become ready';

      throw new ProvisioningError(reason, { retryable: readiness.timedOut });
    }

    // Step 5: Engine-specific setup via kubectl exec
    if (store.engine === 'woocommerce') {
      await auditService.log({
        storeId,
        eventType: 'info',
        message: 'Running WooCommerce setup (WP-CLI via kubectl exec)',
      });

      try {
        const setupResult = await storeSetupService.setupWooCommerce({
          namespace: store.namespace,
          storeId,
          siteUrl: `http://${storeId}${config.store.domainSuffix}`,
          credentials,
        });

        await auditService.log({
          storeId,
          eventType: 'info',
          message: 'WooCommerce setup completed',
          metadata: { setupResult },
        });
      } catch (setupErr) {
        // Setup failure is non-fatal — store is still usable (user completes install via browser)
        logger.warn('WooCommerce setup failed (non-fatal)', {
          storeId,
          error: setupErr.message,
        });
        await auditService.log({
          storeId,
          eventType: 'warning',
          message: `WooCommerce auto-setup failed: ${setupErr.message}. Store is usable — complete setup via browser at /wp-admin.`,
        });
      }
    } else if (store.engine === 'medusa') {
      await auditService.log({
        storeId,
        eventType: 'info',
        message: 'Running MedusaJS setup (Medusa CLI via kubectl exec)',
      });

      try {
        const setupResult = await storeSetupService.setupMedusa({
          namespace: store.namespace,
          storeId,
          credentials,
        });

        await auditService.log({
          storeId,
          eventType: 'info',
          message: 'MedusaJS setup completed',
          metadata: { setupResult },
        });
      } catch (setupErr) {
        // Setup failure is non-fatal — Medusa may auto-run migrations on startup
        logger.warn('MedusaJS setup failed (non-fatal)', {
          storeId,
          error: setupErr.message,
        });
        await auditService.log({
          storeId,
          eventType: 'warning',
          message: `MedusaJS auto-setup failed: ${setupErr.message}. Store may still be usable — check /health endpoint.`,
        });
      }
    }

    // Step 6: Extract URLs
    const storefrontUrl = `http://${storeId}${config.store.domainSuffix}`;
    const adminUrl = store.engine === 'woocommerce'
      ? `${storefrontUrl}/wp-admin`
      : `${storefrontUrl}/admin`;

    // Step 7: Transition to READY
    const now = new Date();
    const provisioningDurationMs = Date.now() - new Date(store.provisioningStartedAt).getTime();

    store = await storeRegistry.update(storeId, {
      status: STATES.READY,
      storefrontUrl,
      adminUrl,
      provisioningCompletedAt: now.toISOString(),
      provisioningDurationMs,
    });

    await auditService.log({
      storeId,
      eventType: 'status_change',
      previousStatus: STATES.PROVISIONING,
      newStatus: STATES.READY,
      message: `Store provisioned successfully in ${Math.round(provisioningDurationMs / 1000)}s`,
      metadata: { storefrontUrl, adminUrl, provisioningDurationMs },
    });

    logger.info('Store provisioned successfully', {
      storeId,
      engine: store.engine,
      durationMs: provisioningDurationMs,
    });

  } catch (err) {
    // Transition to FAILED
    logger.error('Store provisioning failed', { storeId, error: err.message });

    await storeRegistry.update(storeId, {
      status: STATES.FAILED,
      failureReason: err.message,
      provisioningCompletedAt: new Date().toISOString(),
    }).catch(updateErr => {
      logger.error('Failed to update store status to failed', {
        storeId,
        error: updateErr.message,
      });
    });

    await auditService.log({
      storeId,
      eventType: 'error',
      newStatus: STATES.FAILED,
      message: `Provisioning failed: ${err.message}`,
      metadata: { errorCode: err.code, retryable: err.retryable },
    }).catch(() => { }); // never crash on audit failure

  } finally {
    activeOperations.delete(storeId);
  }
}

/**
 * Delete a store.
 * Validates state, transitions to DELETING, then runs cleanup async.
 * 
 * @param {string} storeId
 * @returns {Promise<Object>} Updated store record
 */
async function deleteStore(storeId) {
  const store = await storeRegistry.findById(storeId);
  if (!store) throw new NotFoundError('Store', storeId);

  const deleteCheck = canDelete(store.status);
  if (!deleteCheck.allowed) {
    throw new ConflictError(deleteCheck.reason, 'Wait for the current operation to complete.');
  }

  // Transition to DELETING
  assertTransition(store.status, STATES.DELETING);
  const updatedStore = await storeRegistry.update(storeId, {
    status: STATES.DELETING,
  });

  await auditService.log({
    storeId,
    eventType: 'status_change',
    previousStatus: store.status,
    newStatus: STATES.DELETING,
    message: 'Store deletion initiated',
  });

  // Kick off async deletion
  deleteStoreAsync(storeId).catch(err => {
    logger.error('Unhandled deletion error', { storeId, error: err.message });
  });

  return updatedStore;
}

/**
 * Internal async deletion workflow.
 * 
 * Steps:
 * 1. Uninstall Helm release
 * 2. Delete K8s namespace
 * 3. Verify cleanup
 * 4. Transition to DELETED
 */
async function deleteStoreAsync(storeId) {
  if (activeOperations.has(storeId)) {
    logger.warn('Operation already in progress for store', { storeId });
    return;
  }
  activeOperations.set(storeId, Date.now());

  try {
    const store = await storeRegistry.findById(storeId);
    if (!store) throw new NotFoundError('Store', storeId);

    // Step 1: Uninstall Helm release
    await auditService.log({
      storeId,
      eventType: 'helm_uninstall',
      message: `Uninstalling Helm release '${store.helmRelease}'`,
    });

    await retryWithBackoff(
      () => helmService.uninstall({
        releaseName: store.helmRelease,
        namespace: store.namespace,
      }),
      { maxRetries: 2, operationName: 'helmUninstall' }
    );

    // Step 2: Delete namespace
    await auditService.log({
      storeId,
      eventType: 'info',
      message: `Deleting namespace '${store.namespace}'`,
    });

    await retryWithBackoff(
      () => k8sService.deleteNamespace(store.namespace),
      { maxRetries: 2, operationName: 'deleteNamespace' }
    );

    // Step 3: Wait for cleanup verification (namespace deletion is async)
    let cleanupVerified = false;
    const deadline = Date.now() + 120000; // 2 min max wait
    while (Date.now() < deadline) {
      const cleanup = await k8sService.verifyCleanup(store.namespace);
      if (cleanup.clean) {
        cleanupVerified = true;
        break;
      }
      logger.debug('Waiting for cleanup', { storeId, remaining: cleanup.remaining });
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    if (!cleanupVerified) {
      logger.warn('Cleanup verification timed out — marking deleted anyway', { storeId });
    }

    // Step 4: Transition to DELETED
    await storeRegistry.update(storeId, {
      status: STATES.DELETED,
      deletedAt: new Date().toISOString(),
    });

    await auditService.log({
      storeId,
      eventType: 'status_change',
      previousStatus: STATES.DELETING,
      newStatus: STATES.DELETED,
      message: `Store deleted successfully${cleanupVerified ? '' : ' (cleanup verification timed out)'}`,
    });

    logger.info('Store deleted successfully', { storeId });

  } catch (err) {
    logger.error('Store deletion failed', { storeId, error: err.message });

    await storeRegistry.update(storeId, {
      status: STATES.FAILED,
      failureReason: `Deletion failed: ${err.message}`,
    }).catch(() => { });

    await auditService.log({
      storeId,
      eventType: 'error',
      newStatus: STATES.FAILED,
      message: `Deletion failed: ${err.message}`,
    }).catch(() => { });

  } finally {
    activeOperations.delete(storeId);
  }
}

/**
 * Retry a failed store provisioning.
 * @param {string} storeId
 * @returns {Promise<Object>}
 */
async function retryStore(storeId) {
  const store = await storeRegistry.findById(storeId);
  if (!store) throw new NotFoundError('Store', storeId);

  const retryCheck = canRetry(store.status);
  if (!retryCheck.allowed) {
    throw new ConflictError(retryCheck.reason, 'Only failed stores can be retried.');
  }

  if (store.retryCount >= config.provisioning.maxRetries) {
    throw new ConflictError(
      `Maximum retry count (${config.provisioning.maxRetries}) reached.`,
      'Manual investigation may be required. Delete and recreate the store.'
    );
  }

  // Cleanup any leftover resources before retrying
  try {
    await helmService.uninstall({
      releaseName: store.helmRelease,
      namespace: store.namespace,
    });
    await k8sService.deleteNamespace(store.namespace);
    // Brief wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 5000));
  } catch (cleanupErr) {
    logger.warn('Pre-retry cleanup encountered errors (continuing)', {
      storeId,
      error: cleanupErr.message,
    });
  }

  // Transition back to REQUESTED
  assertTransition(store.status, STATES.REQUESTED);
  await storeRegistry.update(storeId, {
    status: STATES.REQUESTED,
    failureReason: null,
    retryCount: store.retryCount + 1,
    provisioningStartedAt: null,
    provisioningCompletedAt: null,
    provisioningDurationMs: null,
  });

  await auditService.log({
    storeId,
    eventType: 'status_change',
    previousStatus: STATES.FAILED,
    newStatus: STATES.REQUESTED,
    message: `Retry #${store.retryCount + 1} initiated`,
    metadata: { retryCount: store.retryCount + 1 },
  });

  // Kick off provisioning again
  provisionStoreAsync(storeId).catch(err => {
    logger.error('Unhandled retry provisioning error', { storeId, error: err.message });
  });

  return storeRegistry.findById(storeId);
}

/**
 * Get a single store by ID.
 * @param {string} storeId
 * @returns {Promise<Object>}
 */
async function getStore(storeId) {
  const store = await storeRegistry.findById(storeId);
  if (!store) throw new NotFoundError('Store', storeId);
  return store;
}

/**
 * List stores with optional filters.
 * @param {Object} [filters]
 * @returns {Promise<{ stores: Object[], total: number }>}
 */
async function listStores(filters = {}) {
  return storeRegistry.list(filters);
}

/**
 * Get activity logs for a store.
 * @param {string} storeId
 * @param {Object} [options]
 * @returns {Promise<{ logs: Object[], total: number }>}
 */
async function getStoreLogs(storeId, options = {}) {
  const store = await storeRegistry.findById(storeId);
  if (!store) throw new NotFoundError('Store', storeId);
  return auditService.getByStoreId(storeId, options);
}

/**
 * Recover stores stuck in transitional states (called on backend startup).
 * This handles the case where the backend crashed mid-provisioning.
 */
async function recoverStuckStores() {
  const stuck = await storeRegistry.findStuckStores();

  if (stuck.length === 0) {
    logger.info('No stuck stores found on startup');
    return;
  }

  logger.warn(`Found ${stuck.length} store(s) in transitional state — recovering`, {
    storeIds: stuck.map(s => s.id),
  });

  for (const store of stuck) {
    try {
      if (store.status === STATES.REQUESTED || store.status === STATES.PROVISIONING) {
        // Mark as failed — operator can retry
        await storeRegistry.update(store.id, {
          status: STATES.FAILED,
          failureReason: 'Backend restarted during provisioning. Safe to retry.',
        });
        await auditService.log({
          storeId: store.id,
          eventType: 'recovery',
          previousStatus: store.status,
          newStatus: STATES.FAILED,
          message: 'Marked as failed after backend restart',
        });
        logger.info('Recovered stuck provisioning store', { storeId: store.id });
      } else if (store.status === STATES.DELETING) {
        // Resume deletion
        logger.info('Resuming stuck deletion', { storeId: store.id });
        deleteStoreAsync(store.id).catch(err => {
          logger.error('Failed to resume deletion', { storeId: store.id, error: err.message });
        });
      }
    } catch (err) {
      logger.error('Failed to recover stuck store', { storeId: store.id, error: err.message });
    }
  }
}

/**
 * Check if a store operation is currently in progress.
 * @param {string} storeId
 * @returns {boolean}
 */
function isOperationInProgress(storeId) {
  return activeOperations.has(storeId);
}

module.exports = {
  createStore,
  deleteStore,
  retryStore,
  getStore,
  listStores,
  getStoreLogs,
  recoverStuckStores,
  isOperationInProgress,
};
