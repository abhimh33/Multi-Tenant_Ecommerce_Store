'use strict';

const logger = require('./logger').child('retry');

/**
 * Retry a function with exponential backoff.
 * Used for transient failures in Helm/K8s operations.
 * 
 * @param {Function} fn - Async function to retry
 * @param {Object} [options]
 * @param {number} [options.maxRetries=3] - Maximum number of retry attempts
 * @param {number} [options.baseDelayMs=2000] - Base delay between retries
 * @param {number} [options.maxDelayMs=30000] - Maximum delay cap
 * @param {string} [options.operationName='operation'] - Name for logging
 * @param {Function} [options.shouldRetry] - Predicate to decide if retry is appropriate
 * @returns {Promise<*>} Result of the function
 */
async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelayMs = 2000,
    maxDelayMs = 30000,
    operationName = 'operation',
    shouldRetry = () => true,
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;

      if (attempt >= maxRetries) {
        logger.error(`${operationName} failed after ${maxRetries + 1} attempts`, {
          error: err.message,
          attempts: attempt + 1,
        });
        break;
      }

      if (!shouldRetry(err, attempt)) {
        logger.warn(`${operationName} failed with non-retryable error`, {
          error: err.message,
          attempt: attempt + 1,
        });
        break;
      }

      // Exponential backoff with jitter
      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
        maxDelayMs
      );

      logger.warn(`${operationName} attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms`, {
        error: err.message,
        nextAttempt: attempt + 2,
      });

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  retryWithBackoff,
  sleep,
};
