'use strict';

const crypto = require('crypto');

/**
 * Generate a deterministic, collision-resistant store ID.
 * Format: "store-{8 hex chars}" — short enough for namespace names,
 * unique enough for practical purposes (4 billion combinations).
 * 
 * @returns {string} e.g. "store-a1b2c3d4"
 */
function generateStoreId() {
  const hex = crypto.randomBytes(4).toString('hex');
  return `store-${hex}`;
}

/**
 * Generate a unique request ID for API tracing.
 * @returns {string} e.g. "req_a1b2c3d4e5f6"
 */
function generateRequestId() {
  const hex = crypto.randomBytes(6).toString('hex');
  return `req_${hex}`;
}

/**
 * Derive namespace name from store ID.
 * Kubernetes namespace names must be DNS-compatible.
 * @param {string} storeId
 * @returns {string}
 */
function storeIdToNamespace(storeId) {
  // Store IDs already follow DNS naming: store-{hex}
  return storeId;
}

/**
 * Derive Helm release name from store ID.
 * @param {string} storeId
 * @returns {string}
 */
function storeIdToHelmRelease(storeId) {
  return storeId;
}

module.exports = {
  generateStoreId,
  generateRequestId,
  storeIdToNamespace,
  storeIdToHelmRelease,
};
