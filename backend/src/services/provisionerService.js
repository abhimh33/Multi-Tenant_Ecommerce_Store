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
const ingressService = require('./ingressService');
const userService = require('./userService');
const {
  NotFoundError,
  ConflictError,
  StoreLimitError,
  ProvisioningError,
} = require('../utils/errors');
const {
  storesTotal,
  provisioningDuration,
  provisioningStepDuration,
  provisioningFailures,
  activeProvisioningOps,
  provisioningQueueDepth,
  provisioningConcurrent,
  provisioningQueueWaitMs,
  provisioningRejections,
} = require('../utils/metrics');
const { Semaphore } = require('../utils/semaphore');

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

// ─── Lifecycle Phase Constants ───────────────────────────────────────────────
const PHASES = {
  NAMESPACE_CREATE: 'namespace_create',
  HELM_INSTALL: 'helm_install',
  POD_READINESS: 'pod_readiness',
  ENGINE_SETUP: 'engine_setup',
  URL_EXTRACTION: 'url_extraction',
  FINALIZE: 'finalize',
  HELM_UNINSTALL: 'helm_uninstall',
  NAMESPACE_DELETE: 'namespace_delete',
  CLEANUP_VERIFY: 'cleanup_verify',
};

/**
 * Measure the duration of a provisioning step.
 * Logs structured timing data and observes the metric.
 * @param {string} storeId
 * @param {string} engine
 * @param {string} phase - One of PHASES constants
 * @param {string} correlationId - HTTP requestId for traceability
 * @param {Function} fn - Async function to execute and measure
 * @returns {Promise<*>} Result of fn()
 */
async function timedStep(storeId, engine, phase, correlationId, fn) {
  const stepStart = Date.now();
  logger.info(`[lifecycle] Step started: ${phase}`, {
    storeId, engine, phase, correlationId,
  });

  try {
    const result = await fn();
    const durationMs = Date.now() - stepStart;

    provisioningStepDuration.observe({ engine, step: phase }, durationMs);
    logger.info(`[lifecycle] Step completed: ${phase}`, {
      storeId, engine, phase, correlationId, durationMs,
    });

    return result;
  } catch (err) {
    const durationMs = Date.now() - stepStart;
    provisioningStepDuration.observe({ engine, step: phase }, durationMs);
    provisioningFailures.inc({ engine, step: phase });

    logger.error(`[lifecycle] Step failed: ${phase}`, {
      storeId, engine, phase, correlationId, durationMs,
      error: err.message,
    });

    throw err;
  }
}

// In-progress provisioning operations — prevents concurrent provision of same store
const activeOperations = new Map();

// ─── Provisioning Concurrency Semaphore ──────────────────────────────────────
// Limits parallel Helm installs / deletes to prevent resource exhaustion.
// Environment-configurable via PROVISIONING_MAX_CONCURRENT and PROVISIONING_MAX_QUEUE.
const provisioningSemaphore = new Semaphore({
  maxConcurrent: parseInt(process.env.PROVISIONING_MAX_CONCURRENT, 10) || 3,
  maxQueueSize: parseInt(process.env.PROVISIONING_MAX_QUEUE, 10) || 10,
  acquireTimeoutMs: parseInt(process.env.PROVISIONING_QUEUE_TIMEOUT_MS, 10) || 120000,
  name: 'provisioning',
});

/** Update semaphore metrics snapshot */
function updateSemaphoreMetrics() {
  const s = provisioningSemaphore.stats();
  provisioningQueueDepth.set({}, s.queued);
  provisioningConcurrent.set({}, s.active);
}

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
async function createStore({ name, engine, ownerId = 'default', theme, tenantPassword, correlationId }) {
  // Default theme for WooCommerce if not specified
  const resolvedTheme = engine === 'woocommerce' ? (theme || 'storefront') : null;
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
    theme: resolvedTheme,
  });

  await auditService.log({
    storeId,
    eventType: 'store_created',
    newStatus: STATES.REQUESTED,
    message: `Store '${name}' created with engine '${engine}'${resolvedTheme ? ` and theme '${resolvedTheme}'` : ''}`,
    metadata: { engine, ownerId, theme: resolvedTheme },
  });

  // 5. Kick off async provisioning (non-blocking)
  // Pass correlationId for end-to-end request traceability across async work
  provisionStoreAsync(storeId, { tenantPassword, correlationId }).catch(err => {
    logger.error('Unhandled provisioning error', { storeId, error: err.message });
    // If the error is a semaphore rejection, mark the store as failed immediately
    if (err.code === 'PROVISIONING_QUEUE_FULL' || err.code === 'PROVISIONING_QUEUE_TIMEOUT') {
      provisioningRejections.inc({ reason: err.code === 'PROVISIONING_QUEUE_FULL' ? 'queue_full' : 'queue_timeout' });
      storeRegistry.update(storeId, {
        status: STATES.FAILED,
        failureReason: err.message,
      }).catch(() => {});
    }
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
async function provisionStoreAsync(storeId, { tenantPassword, correlationId } = {}) {
  // Prevent concurrent provisioning of the same store
  if (activeOperations.has(storeId)) {
    logger.warn('Provisioning already in progress', { storeId });
    return;
  }
  activeOperations.set(storeId, Date.now());
  const cid = correlationId || `async-${storeId}`;

  // ── Acquire semaphore slot (limits global concurrency) ──
  let release;
  try {
    updateSemaphoreMetrics();
    logger.info('[lifecycle] Waiting for provisioning slot', {
      storeId, correlationId: cid,
      semaphore: provisioningSemaphore.stats(),
    });
    const permit = await provisioningSemaphore.acquire();
    release = permit.release;
    const waitMs = permit.waitMs;

    provisioningQueueWaitMs.observe({}, waitMs);
    updateSemaphoreMetrics();

    if (waitMs > 0) {
      logger.info('[lifecycle] Provisioning slot acquired after queuing', {
        storeId, correlationId: cid, waitMs,
      });
    }
  } catch (semErr) {
    activeOperations.delete(storeId);
    updateSemaphoreMetrics();
    throw semErr; // propagate to caller for FAILED marking
  }

  try {
    let store = await storeRegistry.findById(storeId);
    if (!store) throw new NotFoundError('Store', storeId);

    logger.info('[lifecycle] Provisioning workflow started', {
      storeId, engine: store.engine, correlationId: cid,
    });

    // Step 1: Transition to PROVISIONING (with optimistic lock)
    assertTransition(store.status, STATES.PROVISIONING);
    activeProvisioningOps.inc();
    store = await storeRegistry.update(storeId, {
      status: STATES.PROVISIONING,
      provisioningStartedAt: new Date().toISOString(),
      failureReason: null,
    }, { expectedStatus: store.status });

    if (!store) {
      throw new ConflictError(
        'Store status changed concurrently. Aborting provisioning.',
        'Retry the operation.'
      );
    }

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
      metadata: { namespace: store.namespace, correlationId: cid },
    });

    await timedStep(storeId, store.engine, PHASES.NAMESPACE_CREATE, cid, () =>
      retryWithBackoff(
        () => k8sService.createNamespace(store.namespace, {
          'mt-ecommerce/engine': store.engine,
          'mt-ecommerce/store-name': store.name,
        }),
        { maxRetries: 2, operationName: 'createNamespace' }
      )
    );

    // Step 3: Generate credentials and install Helm chart

    // Generate random credentials for this store (engine-aware)
    const adminPassword = tenantPassword || crypto.randomBytes(12).toString('base64url');
    const dbPassword = crypto.randomBytes(16).toString('base64url');
    let credentials;
    let setValues;

    if (store.engine === 'woocommerce') {
      const dbRootPassword = crypto.randomBytes(16).toString('base64url');

      // Resolve the tenant user's email so the WP admin is synced
      let tenantEmail = 'admin@example.com';
      try {
        const tenantUser = await userService.findById(store.ownerId);
        if (tenantUser && tenantUser.email) {
          tenantEmail = tenantUser.email;
          logger.info('Syncing tenant email as WordPress admin', { storeId, email: tenantEmail });
        }
      } catch (_lookupErr) {
        logger.warn('Could not resolve tenant user, using default email', { storeId, ownerId: store.ownerId });
      }

      credentials = {
        adminUsername: 'admin',
        adminPassword,
        adminEmail: tenantEmail,
        dbPassword,
        dbRootPassword,
      };
      setValues = {
        'wordpress.admin.password': adminPassword,
        'wordpress.admin.username': 'admin',
        'wordpress.admin.email': tenantEmail,
        'wordpress.theme': store.theme || 'storefront',
        'mariadb.rootPassword': dbRootPassword,
        'mariadb.password': dbPassword,
      };
    } else if (store.engine === 'medusa') {
      const jwtSecret = crypto.randomBytes(32).toString('base64url');
      const cookieSecret = crypto.randomBytes(32).toString('base64url');

      // Resolve the tenant user's email so the Medusa admin is synced
      let tenantEmail = 'admin@medusa.local';
      try {
        const tenantUser = await userService.findById(store.ownerId);
        if (tenantUser && tenantUser.email) {
          tenantEmail = tenantUser.email;
          logger.info('Syncing tenant email as Medusa admin', { storeId, email: tenantEmail });
        }
      } catch (_lookupErr) {
        logger.warn('Could not resolve tenant user, using default email', { storeId, ownerId: store.ownerId });
      }

      credentials = {
        adminUsername: 'admin',
        adminPassword,
        adminEmail: tenantEmail,
        dbPassword,
        jwtSecret,
        cookieSecret,
      };
      setValues = {
        'medusa.admin.email': tenantEmail,
        'medusa.admin.password': adminPassword,
        'medusa.jwtSecret': jwtSecret,
        'medusa.cookieSecret': cookieSecret,
        'medusa.postgresql.password': dbPassword,
        // Deploy storefront SPA alongside Medusa backend
        'storefront.enabled': 'true',
        'storefront.image.pullPolicy': 'Never',
        'storefront.storeName': store.name,
      };
    }

    // ── Duplicate Helm release guard (race condition defense) ──
    // Check if a Helm release already exists before attempting install
    const existingRelease = await helmService.status(store.helmRelease, store.namespace);
    if (existingRelease && existingRelease?.info?.status === 'deployed') {
      logger.warn('[lifecycle] Helm release already deployed — skipping install (race condition guard)', {
        storeId, helmRelease: store.helmRelease, correlationId: cid,
      });
      await auditService.log({
        storeId,
        eventType: 'info',
        message: `Helm release '${store.helmRelease}' already deployed — skipping install (duplicate guard)`,
        metadata: { correlationId: cid },
      });
    } else {
      // Clean up non-deployed leftover release if present
      if (existingRelease) {
        logger.info('[lifecycle] Existing release not deployed — cleaning up before install', {
          storeId, status: existingRelease?.info?.status,
        });
        await helmService.uninstall({ releaseName: store.helmRelease, namespace: store.namespace });
      }

      await auditService.log({
        storeId,
        eventType: 'helm_install',
        message: `Installing Helm release '${store.helmRelease}'`,
        metadata: { engine: store.engine, namespace: store.namespace, correlationId: cid },
      });

      await timedStep(storeId, store.engine, PHASES.HELM_INSTALL, cid, () =>
        retryWithBackoff(
          () => helmService.install({
            releaseName: store.helmRelease,
            namespace: store.namespace,
            engine: store.engine,
            setValues,
          }),
          { maxRetries: 1, operationName: 'helmInstall' }
        )
      );
    }

    // Step 4: Quick readiness verification (helm --wait already polled for full readiness)
    await auditService.log({
      storeId,
      eventType: 'info',
      message: 'Verifying pod readiness (post helm --wait)',
      metadata: { correlationId: cid },
    });

    const readiness = await timedStep(storeId, store.engine, PHASES.POD_READINESS, cid, async () => {
      // Since helm --wait already waited for readiness, this is a quick verification
      // with a short timeout (30s). Only polls if the first check shows not-ready.
      const quickCheck = await k8sService.checkPodsReady(store.namespace);
      if (quickCheck.ready) {
        return { ready: true, timedOut: false, durationMs: 0 };
      }
      // Fallback: brief poll in case of timing race
      return k8sService.pollForReadiness(store.namespace, {
        timeoutMs: 30000,
        intervalMs: 3000,
        onProgress: (status) => {
          logger.debug('Post-install readiness check', {
            storeId,
            correlationId: cid,
            podsReady: `${status.podsReadyCount}/${status.podsTotal}`,
          });
        },
      });
    });

    if (!readiness.ready) {
      const reason = readiness.timedOut
        ? `Provisioning timed out after ${Math.round(readiness.durationMs / 1000)}s`
        : readiness.error || 'Pods failed to become ready';

      throw new ProvisioningError(reason, { retryable: readiness.timedOut });
    }

    // Step 4b: Verify ResourceQuota and LimitRange enforcement
    const boundaries = await k8sService.verifyResourceBoundaries(store.namespace);
    if (boundaries.quotaEnforced && boundaries.limitRangeEnforced) {
      logger.info('[lifecycle] Resource boundaries verified', {
        storeId, correlationId: cid,
        quota: boundaries.quota?.name,
        limitRange: boundaries.limitRange?.name,
      });
    } else {
      logger.warn('[lifecycle] Resource boundaries incomplete — tenant isolation may be degraded', {
        storeId, correlationId: cid,
        quotaEnforced: boundaries.quotaEnforced,
        limitRangeEnforced: boundaries.limitRangeEnforced,
      });
    }

    await auditService.log({
      storeId,
      eventType: 'info',
      message: `Resource boundaries: quota=${boundaries.quotaEnforced ? 'enforced' : 'MISSING'}, limitRange=${boundaries.limitRangeEnforced ? 'enforced' : 'MISSING'}`,
      metadata: { boundaries, correlationId: cid },
    });

    // Step 5: Engine-specific setup via kubectl exec
    if (store.engine === 'woocommerce') {
      await auditService.log({
        storeId,
        eventType: 'info',
        message: 'Running WooCommerce setup (WP-CLI via kubectl exec)',
        metadata: { correlationId: cid },
      });

      try {
        const setupResult = await timedStep(storeId, store.engine, PHASES.ENGINE_SETUP, cid, () =>
          storeSetupService.setupWooCommerce({
            namespace: store.namespace,
            storeId,
            siteUrl: config.buildStoreUrl(storeId),
            credentials,
            theme: store.theme || 'storefront',
          })
        );

        await auditService.log({
          storeId,
          eventType: 'info',
          message: 'WooCommerce setup completed',
          metadata: { setupResult, correlationId: cid },
        });
      } catch (setupErr) {
        // Setup failure is non-fatal — store is still usable (user completes install via browser)
        logger.warn('WooCommerce setup failed (non-fatal)', {
          storeId,
          correlationId: cid,
          error: setupErr.message,
        });
        await auditService.log({
          storeId,
          eventType: 'warning',
          message: `WooCommerce auto-setup failed: ${setupErr.message}. Store is usable — complete setup via browser at /wp-admin.`,
          metadata: { correlationId: cid },
        });
      }
    } else if (store.engine === 'medusa') {
      await auditService.log({
        storeId,
        eventType: 'info',
        message: 'Running MedusaJS setup (Medusa CLI via kubectl exec)',
        metadata: { correlationId: cid },
      });

      try {
        const setupResult = await timedStep(storeId, store.engine, PHASES.ENGINE_SETUP, cid, () =>
          storeSetupService.setupMedusa({
            namespace: store.namespace,
            storeId,
            credentials,
            storeName: store.name,
          })
        );

        await auditService.log({
          storeId,
          eventType: 'info',
          message: 'MedusaJS setup completed',
          metadata: { setupResult, correlationId: cid },
        });
      } catch (setupErr) {
        // Setup failure is non-fatal — Medusa may auto-run migrations on startup
        logger.warn('MedusaJS setup failed (non-fatal)', {
          storeId,
          correlationId: cid,
          error: setupErr.message,
        });
        await auditService.log({
          storeId,
          eventType: 'warning',
          message: `MedusaJS auto-setup failed: ${setupErr.message}. Store may still be usable — check /health endpoint.`,
          metadata: { correlationId: cid },
        });
      }
    }

    // Step 6: Extract URLs
    const storefrontUrl = config.buildStoreUrl(storeId);
    const adminUrl = store.engine === 'woocommerce'
      ? `${storefrontUrl}/wp-admin`
      : `${storefrontUrl}/admin`;

    // Step 7: Transition to READY
    const now = new Date();
    const provisioningDurationMs = Date.now() - new Date(store.provisioningStartedAt).getTime();

    // Persist admin credentials so tenant can access them
    const adminCredentialsPayload = store.engine === 'medusa'
      ? { email: credentials.adminEmail, password: credentials.adminPassword }
      : store.engine === 'woocommerce'
        ? { email: credentials.adminEmail, username: credentials.adminUsername, password: credentials.adminPassword }
        : {};

    store = await storeRegistry.update(storeId, {
      status: STATES.READY,
      storefrontUrl,
      adminUrl,
      adminCredentials: adminCredentialsPayload,
      provisioningCompletedAt: now.toISOString(),
      provisioningDurationMs,
    });

    await auditService.log({
      storeId,
      eventType: 'status_change',
      previousStatus: STATES.PROVISIONING,
      newStatus: STATES.READY,
      message: `Store provisioned successfully in ${Math.round(provisioningDurationMs / 1000)}s`,
      metadata: { storefrontUrl, adminUrl, provisioningDurationMs, correlationId: cid },
    });

    logger.info('[lifecycle] Provisioning workflow completed', {
      storeId,
      engine: store.engine,
      correlationId: cid,
      durationMs: provisioningDurationMs,
    });

    // Add hosts file entry for the store (non-blocking, non-fatal)
    const storeHostname = `${storeId}${config.store.domainSuffix}`;
    ingressService.addHostsEntry(storeHostname).catch(err => {
      logger.warn('Failed to add hosts entry (non-fatal)', { storeId, hostname: storeHostname, error: err.message });
    });

    // Update metrics
    storesTotal.inc({ status: 'ready' });
    provisioningDuration.observe({ engine: store.engine }, provisioningDurationMs);

  } catch (err) {
    // Transition to FAILED
    const failureDurationMs = activeOperations.has(storeId)
      ? Date.now() - activeOperations.get(storeId)
      : null;

    logger.error('[lifecycle] Provisioning workflow failed', {
      storeId, correlationId: cid, error: err.message, failureDurationMs,
    });

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
      metadata: { errorCode: err.code, retryable: err.retryable, correlationId: cid, failureDurationMs },
    }).catch(() => { }); // never crash on audit failure

    storesTotal.inc({ status: 'failed' });

  } finally {
    activeOperations.delete(storeId);
    activeProvisioningOps.dec();
    if (release) release();
    updateSemaphoreMetrics();
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

  // Transition to DELETING (with optimistic lock)
  assertTransition(store.status, STATES.DELETING);
  const updatedStore = await storeRegistry.update(storeId, {
    status: STATES.DELETING,
  }, { expectedStatus: store.status });

  if (!updatedStore) {
    throw new ConflictError(
      'Store status changed concurrently. Aborting deletion.',
      'Refresh and try again.'
    );
  }

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
  const deleteStart = Date.now();

  // ── Acquire semaphore slot (limits global concurrency) ──
  let release;
  try {
    updateSemaphoreMetrics();
    const permit = await provisioningSemaphore.acquire();
    release = permit.release;
    if (permit.waitMs > 0) {
      provisioningQueueWaitMs.observe({}, permit.waitMs);
      logger.info('[lifecycle] Deletion slot acquired after queuing', {
        storeId, waitMs: permit.waitMs,
      });
    }
    updateSemaphoreMetrics();
  } catch (semErr) {
    activeOperations.delete(storeId);
    updateSemaphoreMetrics();
    // For deletions, don't reject — log and fail the store
    logger.error('[lifecycle] Deletion queued too long or rejected', { storeId, error: semErr.message });
    await storeRegistry.update(storeId, {
      status: STATES.FAILED,
      failureReason: `Deletion deferred: ${semErr.message}`,
    }).catch(() => { });
    return;
  }

  try {
    const store = await storeRegistry.findById(storeId);
    if (!store) throw new NotFoundError('Store', storeId);

    logger.info('[lifecycle] Deletion workflow started', {
      storeId, engine: store.engine,
    });

    // ── Duplicate release guard: verify Helm release still exists ──
    const existingRelease = await helmService.status(store.helmRelease, store.namespace);
    if (!existingRelease) {
      logger.info('[lifecycle] Helm release already absent — skipping uninstall', {
        storeId, helmRelease: store.helmRelease,
      });
    } else {
      // Step 1: Uninstall Helm release
      await auditService.log({
        storeId,
        eventType: 'helm_uninstall',
        message: `Uninstalling Helm release '${store.helmRelease}'`,
      });

      await timedStep(storeId, store.engine, PHASES.HELM_UNINSTALL, `delete-${storeId}`, () =>
        retryWithBackoff(
          () => helmService.uninstall({
            releaseName: store.helmRelease,
            namespace: store.namespace,
          }),
          { maxRetries: 2, operationName: 'helmUninstall' }
        )
      );
    }

    // Step 2: Delete namespace
    await auditService.log({
      storeId,
      eventType: 'info',
      message: `Deleting namespace '${store.namespace}'`,
    });

    await timedStep(storeId, store.engine, PHASES.NAMESPACE_DELETE, `delete-${storeId}`, () =>
      retryWithBackoff(
        () => k8sService.deleteNamespace(store.namespace),
        { maxRetries: 2, operationName: 'deleteNamespace' }
      )
    );

    // Step 3: Wait for cleanup verification (namespace deletion is async)
    const cleanupVerified = await timedStep(storeId, store.engine, PHASES.CLEANUP_VERIFY, `delete-${storeId}`, async () => {
      const deadline = Date.now() + 120000; // 2 min max wait
      while (Date.now() < deadline) {
        const cleanup = await k8sService.verifyCleanup(store.namespace);
        if (cleanup.clean) return true;
        logger.debug('Waiting for cleanup', { storeId, remaining: cleanup.remaining });
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      logger.warn('Cleanup verification timed out — marking deleted anyway', { storeId });
      return false;
    });

    const deletionDurationMs = Date.now() - deleteStart;

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
      message: `Store deleted successfully in ${Math.round(deletionDurationMs / 1000)}s${cleanupVerified ? '' : ' (cleanup verification timed out)'}`,
      metadata: { deletionDurationMs, cleanupVerified },
    });

    logger.info('[lifecycle] Deletion workflow completed', {
      storeId, engine: store.engine, deletionDurationMs,
    });

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
    if (release) release();
    updateSemaphoreMetrics();
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

  // Cleanup any leftover resources before retrying (idempotent)
  logger.info('[lifecycle] Pre-retry cleanup started', { storeId, retryCount: store.retryCount + 1 });
  try {
    await helmService.uninstall({
      releaseName: store.helmRelease,
      namespace: store.namespace,
    });
  } catch (cleanupErr) {
    logger.debug('Helm uninstall during pre-retry cleanup (expected if no release)', {
      storeId, error: cleanupErr.message,
    });
  }

  try {
    await k8sService.deleteNamespace(store.namespace);
  } catch (cleanupErr) {
    logger.debug('Namespace delete during pre-retry cleanup (expected if no namespace)', {
      storeId, error: cleanupErr.message,
    });
  }

  // Wait and verify cleanup — ensure no leftover resources before re-provisioning
  const cleanupDeadline = Date.now() + 15000; // 15s max wait
  while (Date.now() < cleanupDeadline) {
    try {
      const cleanup = await k8sService.verifyCleanup(store.namespace);
      if (cleanup.clean) {
        logger.info('[lifecycle] Pre-retry cleanup verified — namespace is clean', { storeId });
        break;
      }
    } catch (_err) {
      // verifyCleanup may throw if namespace doesn't exist — that's clean
      logger.info('[lifecycle] Pre-retry cleanup verified — namespace not found', { storeId });
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  await auditService.log({
    storeId,
    eventType: 'info',
    message: `Pre-retry cleanup completed. Leftover resources removed before retry #${store.retryCount + 1}`,
    metadata: { retryCount: store.retryCount + 1 },
  });

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
 * 
 * Recovery strategy:
 * - REQUESTED / PROVISIONING → mark as FAILED (safe to retry)
 * - DELETING → resume async deletion to completion
 * 
 * Each recovery action is audited for full traceability.
 */
async function recoverStuckStores() {
  const stuck = await storeRegistry.findStuckStores();

  if (stuck.length === 0) {
    logger.info('[lifecycle] No stuck stores found on startup — state is consistent');
    return;
  }

  logger.warn(`[lifecycle] Found ${stuck.length} store(s) in transitional state — initiating recovery`, {
    storeIds: stuck.map(s => s.id),
    states: stuck.map(s => ({ id: s.id, status: s.status, engine: s.engine })),
  });

  let recoveredCount = 0;
  let resumedCount = 0;
  let failedCount = 0;

  for (const store of stuck) {
    try {
      if (store.status === STATES.REQUESTED || store.status === STATES.PROVISIONING) {
        // Calculate how long the store was stuck
        const stuckSince = store.provisioningStartedAt || store.createdAt;
        const stuckDurationMs = stuckSince ? Date.now() - new Date(stuckSince).getTime() : null;

        // Mark as failed — operator can retry
        await storeRegistry.update(store.id, {
          status: STATES.FAILED,
          failureReason: 'Backend restarted during provisioning. Safe to retry.',
          provisioningCompletedAt: new Date().toISOString(),
        });
        await auditService.log({
          storeId: store.id,
          eventType: 'recovery',
          previousStatus: store.status,
          newStatus: STATES.FAILED,
          message: `Recovered after backend restart. Was stuck in '${store.status}' for ${stuckDurationMs ? Math.round(stuckDurationMs / 1000) + 's' : 'unknown duration'}.`,
          metadata: { stuckDurationMs, previousStatus: store.status, engine: store.engine },
        });
        logger.info('[lifecycle] Recovered stuck provisioning store', {
          storeId: store.id, previousStatus: store.status, engine: store.engine, stuckDurationMs,
        });
        recoveredCount++;
      } else if (store.status === STATES.DELETING) {
        // Resume deletion
        logger.info('[lifecycle] Resuming stuck deletion', { storeId: store.id, engine: store.engine });
        await auditService.log({
          storeId: store.id,
          eventType: 'recovery',
          previousStatus: STATES.DELETING,
          message: 'Resuming deletion after backend restart',
          metadata: { engine: store.engine },
        });
        deleteStoreAsync(store.id).catch(err => {
          logger.error('Failed to resume deletion', { storeId: store.id, error: err.message });
        });
        resumedCount++;
      }
    } catch (err) {
      logger.error('[lifecycle] Failed to recover stuck store', {
        storeId: store.id, error: err.message,
      });
      failedCount++;
    }
  }

  logger.info('[lifecycle] Recovery summary', {
    total: stuck.length, recovered: recoveredCount, resumed: resumedCount, failed: failedCount,
  });
}

/**
 * Check if a store operation is currently in progress.
 * @param {string} storeId
 * @returns {boolean}
 */
function isOperationInProgress(storeId) {
  return activeOperations.has(storeId);
}

/**
 * Get provisioning concurrency stats for health/metrics endpoints.
 * @returns {Object}
 */
function getConcurrencyStats() {
  return {
    ...provisioningSemaphore.stats(),
    activeOperations: activeOperations.size,
  };
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
  getConcurrencyStats,
};
