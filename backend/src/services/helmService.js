'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger').child('helm');
const { HelmError } = require('../utils/errors');

const execFileAsync = promisify(execFile);

/**
 * Helm Service — wraps Helm CLI for install, uninstall, status, and list operations.
 * 
 * Design decisions:
 * - Uses Helm CLI (not a Go SDK) because Node.js has no native Helm library.
 * - All operations are idempotent: install uses --install, uninstall tolerates not-found.
 * - JSON output is parsed for structured data.
 * - Timeouts are enforced at both Helm and process level.
 */

const HELM_BIN = process.env.HELM_BIN || 'helm';

/**
 * Install or upgrade a Helm release.
 * Uses `helm upgrade --install` for idempotency.
 * 
 * @param {Object} params
 * @param {string} params.releaseName - Helm release name
 * @param {string} params.namespace - Kubernetes namespace
 * @param {string} params.engine - Store engine (woocommerce|medusa)
 * @param {Object} [params.setValues] - --set overrides as key=value pairs
 * @param {string} [params.valuesFile] - Additional values file
 * @returns {Promise<Object>} Helm release info
 */
async function install({ releaseName, namespace, engine, setValues = {}, valuesFile }) {
  const args = [
    'upgrade', '--install',
    releaseName,
    config.helm.chartPath,
    '--namespace', namespace,
    '--create-namespace',
    '--wait',
    '--timeout', config.helm.timeout,
    '--output', 'json',
  ];

  // Apply the environment-specific values file
  const envValuesPath = path.join(config.helm.chartPath, config.helm.valuesFile);
  args.push('--values', envValuesPath);

  // Apply optional additional values file
  if (valuesFile) {
    args.push('--values', valuesFile);
  }

  // Apply engine and store-specific set values
  const allSetValues = {
    engine,
    storeId: releaseName,
    storeName: releaseName,
    ...setValues,
  };

  for (const [key, value] of Object.entries(allSetValues)) {
    args.push('--set', `${key}=${value}`);
  }

  if (config.helm.debug) {
    args.push('--debug');
  }

  logger.info('Installing Helm release', { releaseName, namespace, engine });
  logger.debug('Helm command', { args: [HELM_BIN, ...args].join(' ') });

  try {
    const { stdout, stderr } = await execFileAsync(HELM_BIN, args, {
      timeout: 720000, // 12 min hard process timeout (above Helm's own timeout)
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    if (stderr) {
      logger.debug('Helm stderr', { stderr: stderr.substring(0, 500) });
    }

    let release;
    try {
      release = JSON.parse(stdout);
    } catch {
      // Some Helm versions output non-JSON with --wait
      release = { info: { status: 'deployed' } };
    }

    logger.info('Helm release installed successfully', {
      releaseName,
      namespace,
      status: release?.info?.status || 'deployed',
    });

    return {
      name: releaseName,
      namespace,
      status: release?.info?.status || 'deployed',
      raw: release,
    };
  } catch (err) {
    const message = parseHelmError(err);
    logger.error('Helm install failed', { releaseName, namespace, error: message });
    throw new HelmError(`Helm install failed for ${releaseName}: ${message}`, {
      retryable: isRetryableHelmError(err),
      metadata: { releaseName, namespace, stderr: err.stderr?.substring(0, 1000) },
    });
  }
}

/**
 * Uninstall a Helm release.
 * Idempotent — does not error if release does not exist.
 * 
 * @param {Object} params
 * @param {string} params.releaseName
 * @param {string} params.namespace
 * @returns {Promise<boolean>} true if uninstalled, false if not found
 */
async function uninstall({ releaseName, namespace }) {
  const args = [
    'uninstall',
    releaseName,
    '--namespace', namespace,
    '--wait',
    '--timeout', config.helm.timeout,
  ];

  logger.info('Uninstalling Helm release', { releaseName, namespace });

  try {
    await execFileAsync(HELM_BIN, args, {
      timeout: 720000,
    });

    logger.info('Helm release uninstalled', { releaseName, namespace });
    return true;
  } catch (err) {
    // "not found" is not an error for idempotent uninstall
    if (err.stderr && err.stderr.includes('not found')) {
      logger.info('Helm release not found (already uninstalled)', { releaseName, namespace });
      return false;
    }

    const message = parseHelmError(err);
    logger.error('Helm uninstall failed', { releaseName, namespace, error: message });
    throw new HelmError(`Helm uninstall failed for ${releaseName}: ${message}`, {
      retryable: isRetryableHelmError(err),
      metadata: { releaseName, namespace },
    });
  }
}

/**
 * Get the status of a Helm release.
 * @param {string} releaseName
 * @param {string} namespace
 * @returns {Promise<Object|null>} Release status or null if not found
 */
async function status(releaseName, namespace) {
  const args = [
    'status',
    releaseName,
    '--namespace', namespace,
    '--output', 'json',
  ];

  try {
    const { stdout } = await execFileAsync(HELM_BIN, args, { timeout: 30000 });
    return JSON.parse(stdout);
  } catch (err) {
    if (err.stderr && err.stderr.includes('not found')) {
      return null;
    }
    const message = parseHelmError(err);
    throw new HelmError(`Helm status check failed: ${message}`, {
      retryable: true,
      metadata: { releaseName, namespace },
    });
  }
}

/**
 * List all Helm releases, optionally filtered by namespace.
 * @param {string} [namespace] - If provided, only releases in this namespace
 * @returns {Promise<Object[]>}
 */
async function list(namespace) {
  const args = ['list', '--output', 'json'];
  if (namespace) {
    args.push('--namespace', namespace);
  } else {
    args.push('--all-namespaces');
  }

  try {
    const { stdout } = await execFileAsync(HELM_BIN, args, { timeout: 30000 });
    return JSON.parse(stdout || '[]');
  } catch (err) {
    const message = parseHelmError(err);
    throw new HelmError(`Helm list failed: ${message}`, { retryable: true });
  }
}

/**
 * Rollback a Helm release to a previous revision.
 * @param {string} releaseName
 * @param {string} namespace
 * @param {number} [revision=0] - 0 = previous revision
 * @returns {Promise<void>}
 */
async function rollback(releaseName, namespace, revision = 0) {
  const args = [
    'rollback',
    releaseName,
    String(revision),
    '--namespace', namespace,
    '--wait',
    '--timeout', config.helm.timeout,
  ];

  logger.info('Rolling back Helm release', { releaseName, namespace, revision });

  try {
    await execFileAsync(HELM_BIN, args, { timeout: 720000 });
    logger.info('Helm rollback complete', { releaseName, namespace });
  } catch (err) {
    const message = parseHelmError(err);
    throw new HelmError(`Helm rollback failed: ${message}`, {
      retryable: false,
      metadata: { releaseName, namespace, revision },
    });
  }
}

/**
 * Extract a clean error message from a Helm CLI error.
 */
function parseHelmError(err) {
  if (err.stderr) {
    // Take the last meaningful line from stderr
    const lines = err.stderr.trim().split('\n').filter(l => l.trim());
    return lines[lines.length - 1] || err.message;
  }
  return err.message;
}

/**
 * Determine if a Helm error is transient and safe to retry.
 */
function isRetryableHelmError(err) {
  const msg = (err.stderr || err.message || '').toLowerCase();
  const retryablePatterns = [
    'timeout',
    'connection refused',
    'connection reset',
    'i/o timeout',
    'tls handshake',
    'service unavailable',
    'too many requests',
  ];
  return retryablePatterns.some(p => msg.includes(p));
}

module.exports = {
  install,
  uninstall,
  status,
  list,
  rollback,
};
