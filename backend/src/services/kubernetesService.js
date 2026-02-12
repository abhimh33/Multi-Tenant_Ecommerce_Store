'use strict';

const k8s = require('@kubernetes/client-node');
const config = require('../config');
const logger = require('../utils/logger').child('kubernetes');
const { KubernetesError } = require('../utils/errors');
const { getCircuitBreaker } = require('../utils/circuitBreaker');

/**
 * Kubernetes Service — wraps @kubernetes/client-node for namespace management,
 * readiness polling, and resource cleanup verification.
 * 
 * Initialized lazily on first use — supports running the backend
 * without a K8s cluster for development/testing.
 * Circuit breaker prevents hammering the API server when it's unreachable.
 */

let coreApi = null;
let _appsApi = null; // initialized for future use (e.g. Deployments/StatefulSets)
let networkingApi = null;
let kubeConfig = null;

// Circuit breaker for K8s API operations
const k8sBreaker = getCircuitBreaker('kubernetes', {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  isFailure: (err) => {
    // Only count transient failures, not 404s or 409s
    const status = err.statusCode || err.response?.statusCode;
    return !status || status >= 500 || status === 0;
  },
});

/**
 * Initialize the Kubernetes client.
 * Loads kubeconfig from the environment or default location.
 */
function initClient() {
  if (coreApi) return;

  try {
    kubeConfig = new k8s.KubeConfig();

    if (config.kubernetes.kubeconfig) {
      kubeConfig.loadFromFile(config.kubernetes.kubeconfig);
    } else {
      kubeConfig.loadFromDefault();
    }

    if (config.kubernetes.context) {
      kubeConfig.setCurrentContext(config.kubernetes.context);
    }

    coreApi = kubeConfig.makeApiClient(k8s.CoreV1Api);
    _appsApi = kubeConfig.makeApiClient(k8s.AppsV1Api);
    networkingApi = kubeConfig.makeApiClient(k8s.NetworkingV1Api);

    logger.info('Kubernetes client initialized', {
      context: kubeConfig.getCurrentContext(),
      cluster: kubeConfig.getCurrentCluster()?.server,
    });
  } catch (err) {
    logger.error('Failed to initialize Kubernetes client', { error: err.message });
    throw new KubernetesError(`Failed to initialize Kubernetes client: ${err.message}`, {
      retryable: false,
    });
  }
}

/**
 * Ensure the client is initialized before use.
 */
function ensureClient() {
  if (!coreApi) {
    initClient();
  }
}

// ─── Namespace Operations ───────────────────────────────────────────────────

/**
 * Create a Kubernetes namespace. Idempotent — returns existing if found.
 * @param {string} name - Namespace name
 * @param {Object} [labels] - Labels to apply
 * @returns {Promise<Object>} Namespace object
 */
async function createNamespace(name, labels = {}) {
  ensureClient();

  const defaultLabels = {
    'app.kubernetes.io/managed-by': 'mt-ecommerce',
    'mt-ecommerce/store-id': name,
  };

  try {
    const res = await k8sBreaker.call(() => coreApi.createNamespace({
      metadata: {
        name,
        labels: { ...defaultLabels, ...labels },
      },
    }));
    logger.info('Namespace created', { namespace: name });
    return res.body || res;
  } catch (err) {
    if (err.statusCode === 409) {
      logger.info('Namespace already exists', { namespace: name });
      return getNamespace(name);
    }
    logger.error('Failed to create namespace', { namespace: name, error: err.message });
    throw new KubernetesError(`Failed to create namespace ${name}: ${err.message}`, {
      retryable: true,
    });
  }
}

/**
 * Get a namespace by name.
 * @param {string} name
 * @returns {Promise<Object|null>}
 */
async function getNamespace(name) {
  ensureClient();
  try {
    const res = await coreApi.readNamespace(name);
    return res.body || res;
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw new KubernetesError(`Failed to get namespace ${name}: ${err.message}`);
  }
}

/**
 * Delete a namespace and all resources within it.
 * @param {string} name
 * @returns {Promise<boolean>} true if deleted, false if not found
 */
async function deleteNamespace(name) {
  ensureClient();
  try {
    await k8sBreaker.call(() => coreApi.deleteNamespace(name));
    logger.info('Namespace deletion initiated', { namespace: name });
    return true;
  } catch (err) {
    if (err.statusCode === 404) {
      logger.info('Namespace not found (already deleted)', { namespace: name });
      return false;
    }
    logger.error('Failed to delete namespace', { namespace: name, error: err.message });
    throw new KubernetesError(`Failed to delete namespace ${name}: ${err.message}`, {
      retryable: true,
    });
  }
}

// ─── Readiness Checks ────────────────────────────────────────────────────────

/**
 * Check if all pods in a namespace are ready.
 * @param {string} namespace
 * @returns {Promise<{ ready: boolean, total: number, readyCount: number, pods: Object[] }>}
 */
async function checkPodsReady(namespace) {
  ensureClient();
  try {
    const response = await coreApi.listNamespacedPod(namespace);
    const pods = response.body?.items || response.items || [];

    // Exclude completed/succeeded jobs
    const relevantPods = pods.filter(p =>
      p.status?.phase !== 'Succeeded' && p.status?.phase !== 'Failed'
    );

    const readyPods = relevantPods.filter(p => {
      const conditions = p.status?.conditions || [];
      return conditions.some(c => c.type === 'Ready' && c.status === 'True');
    });

    const podSummary = relevantPods.map(p => ({
      name: p.metadata?.name,
      phase: p.status?.phase,
      ready: (p.status?.conditions || []).some(c => c.type === 'Ready' && c.status === 'True'),
    }));

    return {
      ready: relevantPods.length > 0 && readyPods.length === relevantPods.length,
      total: relevantPods.length,
      readyCount: readyPods.length,
      pods: podSummary,
    };
  } catch (err) {
    if (err.statusCode === 404) {
      return { ready: false, total: 0, readyCount: 0, pods: [] };
    }
    throw new KubernetesError(`Failed to check pods in ${namespace}: ${err.message}`);
  }
}

/**
 * Check if all Jobs in a namespace have completed successfully.
 * @param {string} namespace
 * @returns {Promise<{ allComplete: boolean, jobs: Object[] }>}
 */
async function checkJobsComplete(namespace) {
  ensureClient();
  try {
    const response = await coreApi.listNamespacedPod(namespace);
    const allPods = response.body?.items || response.items || [];

    // Find job pods (managed by a Job controller)
    const jobPods = allPods.filter(p =>
      p.metadata?.ownerReferences?.some(ref => ref.kind === 'Job')
    );

    if (jobPods.length === 0) {
      return { allComplete: true, jobs: [] };
    }

    const jobSummary = jobPods.map(p => ({
      name: p.metadata?.name,
      phase: p.status?.phase,
      succeeded: p.status?.phase === 'Succeeded',
      failed: p.status?.phase === 'Failed',
    }));

    const allComplete = jobPods.every(p => p.status?.phase === 'Succeeded');

    return { allComplete, jobs: jobSummary };
  } catch (err) {
    throw new KubernetesError(`Failed to check jobs in ${namespace}: ${err.message}`);
  }
}

// ─── Resource Verification ───────────────────────────────────────────────────

/**
 * Verify that a namespace has been fully cleaned up (no remaining resources).
 * Used after helm uninstall + namespace deletion to confirm zero orphans.
 * @param {string} namespace
 * @returns {Promise<{ clean: boolean, remaining: string[] }>}
 */
async function verifyCleanup(namespace) {
  ensureClient();
  const remaining = [];

  try {
    const ns = await getNamespace(namespace);
    if (ns) {
      remaining.push('namespace still exists');

      // Check for remaining pods
      const podsRes = await coreApi.listNamespacedPod(namespace);
      const podItems = podsRes.body?.items || podsRes.items || [];
      if (podItems.length > 0) {
        remaining.push(`${podItems.length} pod(s)`);
      }

      // Check for remaining PVCs
      const pvcsRes = await coreApi.listNamespacedPersistentVolumeClaim(namespace);
      const pvcItems = pvcsRes.body?.items || pvcsRes.items || [];
      if (pvcItems.length > 0) {
        remaining.push(`${pvcItems.length} PVC(s)`);
      }

      // Check for remaining services
      const svcsRes = await coreApi.listNamespacedService(namespace);
      const svcItems = svcsRes.body?.items || svcsRes.items || [];
      // Filter out default kubernetes service
      const userSvcs = svcItems.filter(s => s.metadata?.name !== 'kubernetes');
      if (userSvcs.length > 0) {
        remaining.push(`${userSvcs.length} service(s)`);
      }
    }
  } catch (err) {
    if (err.statusCode !== 404) {
      logger.warn('Error during cleanup verification', { namespace, error: err.message });
    }
  }

  return {
    clean: remaining.length === 0,
    remaining,
  };
}

/**
 * Get ingress resources in a namespace.
 * Used to extract store URLs after deployment.
 * @param {string} namespace
 * @returns {Promise<Object[]>}
 */
async function getIngresses(namespace) {
  ensureClient();
  try {
    const response = await networkingApi.listNamespacedIngress(namespace);
    const ingressItems = response.body?.items || response.items || [];
    return ingressItems.map(ing => ({
      name: ing.metadata?.name,
      hosts: (ing.spec?.rules || []).map(r => r.host).filter(Boolean),
      paths: (ing.spec?.rules || []).flatMap(r =>
        (r.http?.paths || []).map(p => ({
          path: p.path,
          service: p.backend?.service?.name,
        }))
      ),
    }));
  } catch (err) {
    if (err.statusCode === 404) return [];
    throw new KubernetesError(`Failed to get ingresses in ${namespace}: ${err.message}`);
  }
}

// ─── Health Check ────────────────────────────────────────────────────────────

/**
 * List all namespaces managed by the mt-ecommerce platform.
 * @returns {Promise<Object[]>} Array of { name, storeId, createdAt }
 */
async function listManagedNamespaces() {
  ensureClient();
  try {
    const response = await coreApi.listNamespace(
      undefined, undefined, undefined, undefined,
      'app.kubernetes.io/managed-by=mt-ecommerce'
    );
    const nsItems = response.body?.items || response.items || [];
    return nsItems.map(ns => ({
      name: ns.metadata?.name,
      storeId: ns.metadata?.labels?.['mt-ecommerce/store-id'] || ns.metadata?.name,
      createdAt: ns.metadata?.creationTimestamp,
      phase: ns.status?.phase,
    }));
  } catch (err) {
    logger.error('Failed to list managed namespaces', { error: err.message });
    throw new KubernetesError(`Failed to list managed namespaces: ${err.message}`);
  }
}

/**
 * Check Kubernetes cluster connectivity.
 * @returns {Promise<{ connected: boolean, context?: string, server?: string }>}
 */
async function healthCheck() {
  try {
    ensureClient();
    await coreApi.listNamespace();
    return {
      connected: true,
      context: kubeConfig.getCurrentContext(),
      server: kubeConfig.getCurrentCluster()?.server,
    };
  } catch (err) {
    return {
      connected: false,
      error: err.message,
    };
  }
}

// ─── Polling Helper ──────────────────────────────────────────────────────────

/**
 * Poll for namespace readiness with timeout.
 * Waits until all pods are ready and all jobs are complete.
 * @param {string} namespace
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=600000]
 * @param {number} [options.intervalMs=5000]
 * @param {Function} [options.onProgress] - Called on each poll with status
 * @returns {Promise<{ ready: boolean, timedOut: boolean, durationMs: number }>}
 */
async function pollForReadiness(namespace, options = {}) {
  const {
    timeoutMs = config.provisioning.timeoutMs,
    intervalMs = config.provisioning.pollIntervalMs,
    onProgress,
  } = options;

  const startTime = Date.now();
  const deadline = startTime + timeoutMs;

  while (Date.now() < deadline) {
    const podsStatus = await checkPodsReady(namespace);
    const jobsStatus = await checkJobsComplete(namespace);

    const status = {
      podsReady: podsStatus.ready,
      podsTotal: podsStatus.total,
      podsReadyCount: podsStatus.readyCount,
      jobsComplete: jobsStatus.allComplete,
      elapsedMs: Date.now() - startTime,
    };

    if (onProgress) {
      onProgress(status);
    }

    logger.debug('Readiness poll', { namespace, ...status });

    if (podsStatus.ready && jobsStatus.allComplete) {
      return {
        ready: true,
        timedOut: false,
        durationMs: Date.now() - startTime,
      };
    }

    // Check if any pods have failed
    const failedPods = podsStatus.pods.filter(p => p.phase === 'Failed');
    if (failedPods.length > 0) {
      logger.error('Pod failure detected during readiness poll', {
        namespace,
        failedPods: failedPods.map(p => p.name),
      });
      return {
        ready: false,
        timedOut: false,
        durationMs: Date.now() - startTime,
        error: `Pod(s) failed: ${failedPods.map(p => p.name).join(', ')}`,
      };
    }

    // Check if any jobs have failed
    const failedJobs = jobsStatus.jobs.filter(j => j.failed);
    if (failedJobs.length > 0) {
      logger.error('Job failure detected during readiness poll', {
        namespace,
        failedJobs: failedJobs.map(j => j.name),
      });
      return {
        ready: false,
        timedOut: false,
        durationMs: Date.now() - startTime,
        error: `Job(s) failed: ${failedJobs.map(j => j.name).join(', ')}`,
      };
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  logger.warn('Readiness poll timed out', { namespace, timeoutMs });
  return {
    ready: false,
    timedOut: true,
    durationMs: Date.now() - startTime,
  };
}

module.exports = {
  initClient,
  createNamespace,
  getNamespace,
  deleteNamespace,
  listManagedNamespaces,
  checkPodsReady,
  checkJobsComplete,
  verifyCleanup,
  getIngresses,
  healthCheck,
  pollForReadiness,
};
