'use strict';

const logger = require('./logger').child('circuit-breaker');

/**
 * Circuit Breaker — prevents cascading failures when external services (K8s, Helm) are down.
 * 
 * States:
 * - CLOSED:    Normal operation, requests pass through.
 * - OPEN:      Too many failures, requests fail immediately without calling the service.
 * - HALF_OPEN: After reset timeout, allow a limited number of test requests through.
 * 
 * Usage:
 *   const breaker = new CircuitBreaker('helm', { failureThreshold: 5, resetTimeoutMs: 30000 });
 *   const result = await breaker.call(() => helmService.install(...));
 */

const STATES = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
};

class CircuitBreaker {
  /**
   * @param {string} name - Name of the circuit (for logging)
   * @param {Object} [options]
   * @param {number} [options.failureThreshold=5] - Failures before opening
   * @param {number} [options.resetTimeoutMs=30000] - Time before transitioning to HALF_OPEN
   * @param {number} [options.halfOpenMax=2] - Max test requests in HALF_OPEN state
   * @param {Function} [options.isFailure] - Custom predicate for what counts as failure
   */
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = parseInt(process.env.CB_FAILURE_THRESHOLD, 10) || options.failureThreshold || 5;
    this.resetTimeoutMs = parseInt(process.env.CB_RESET_TIMEOUT_MS, 10) || options.resetTimeoutMs || 30000;
    this.halfOpenMax = parseInt(process.env.CB_HALF_OPEN_MAX, 10) || options.halfOpenMax || 2;
    this.isFailure = options.isFailure || (() => true);

    this.state = STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.halfOpenAttempts = 0;
  }

  /**
   * Execute an async function through the circuit breaker.
   * @param {Function} fn - Async function to execute
   * @returns {Promise<*>} Result of the function
   * @throws {Error} CircuitOpenError if circuit is OPEN
   */
  async call(fn) {
    if (this.state === STATES.OPEN) {
      // Check if reset timeout has elapsed
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this._transitionTo(STATES.HALF_OPEN);
      } else {
        const retryInMs = this.resetTimeoutMs - (Date.now() - this.lastFailureTime);
        const err = new Error(
          `Circuit breaker '${this.name}' is OPEN. Service appears unavailable. ` +
          `Retry in ${Math.ceil(retryInMs / 1000)}s.`
        );
        err.code = 'CIRCUIT_OPEN';
        err.retryable = true;
        err.retryAfterMs = retryInMs;
        throw err;
      }
    }

    if (this.state === STATES.HALF_OPEN && this.halfOpenAttempts >= this.halfOpenMax) {
      const err = new Error(
        `Circuit breaker '${this.name}' is HALF_OPEN and max test requests reached. Wait for result.`
      );
      err.code = 'CIRCUIT_HALF_OPEN';
      err.retryable = true;
      throw err;
    }

    if (this.state === STATES.HALF_OPEN) {
      this.halfOpenAttempts++;
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      if (this.isFailure(err)) {
        this._onFailure(err);
      }
      throw err;
    }
  }

  /** Record a successful call. */
  _onSuccess() {
    if (this.state === STATES.HALF_OPEN) {
      logger.info(`Circuit '${this.name}' recovered — closing`, {
        circuit: this.name,
        previousFailures: this.failureCount,
      });
      this._transitionTo(STATES.CLOSED);
    }
    this.failureCount = 0;
    this.successCount++;
  }

  /** Record a failed call. */
  _onFailure(err) {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === STATES.HALF_OPEN) {
      logger.warn(`Circuit '${this.name}' test request failed — reopening`, {
        circuit: this.name,
        error: err.message,
      });
      this._transitionTo(STATES.OPEN);
      return;
    }

    if (this.failureCount >= this.failureThreshold) {
      logger.error(`Circuit '${this.name}' OPENED after ${this.failureCount} failures`, {
        circuit: this.name,
        threshold: this.failureThreshold,
        lastError: err.message,
      });
      this._transitionTo(STATES.OPEN);
    }
  }

  /** Transition to a new state. */
  _transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;
    this.halfOpenAttempts = 0;

    if (newState === STATES.CLOSED) {
      this.failureCount = 0;
    }

    logger.debug(`Circuit '${this.name}' state: ${oldState} → ${newState}`, {
      circuit: this.name,
    });
  }

  /** Get current circuit breaker stats. */
  getStats() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      failureThreshold: this.failureThreshold,
      resetTimeoutMs: this.resetTimeoutMs,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /** Manually reset the circuit breaker. */
  reset() {
    this._transitionTo(STATES.CLOSED);
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    logger.info(`Circuit '${this.name}' manually reset`);
  }
}

// Singleton registry for all circuit breakers
const registry = new Map();

/**
 * Get or create a named circuit breaker.
 * @param {string} name
 * @param {Object} [options]
 * @returns {CircuitBreaker}
 */
function getCircuitBreaker(name, options = {}) {
  if (!registry.has(name)) {
    registry.set(name, new CircuitBreaker(name, options));
  }
  return registry.get(name);
}

/**
 * Get stats for all circuit breakers.
 * @returns {Object[]}
 */
function getAllStats() {
  return Array.from(registry.values()).map(cb => cb.getStats());
}

/**
 * Reset all circuit breakers.
 */
function resetAll() {
  for (const cb of registry.values()) {
    cb.reset();
  }
}

module.exports = {
  CircuitBreaker,
  getCircuitBreaker,
  getAllStats,
  resetAll,
  STATES,
};
