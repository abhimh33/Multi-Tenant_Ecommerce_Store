'use strict';

/**
 * Async Semaphore — controls concurrency for provisioning operations.
 *
 * Prevents resource exhaustion by limiting how many stores can be provisioned
 * simultaneously. Callers that exceed the limit are either queued (up to a
 * maximum queue depth) or immediately rejected.
 *
 * Design:
 * - maxConcurrent: How many operations can run simultaneously.
 * - maxQueueSize:  How many callers can wait in the queue before rejection.
 * - acquireTimeoutMs: Max time a caller can wait in the queue.
 * - Metrics hooks let callers observe queue depth, wait time, and rejections.
 */

const logger = require('./logger').child('semaphore');

class Semaphore {
  /**
   * @param {Object} options
   * @param {number} options.maxConcurrent - Max parallel operations (default: 3)
   * @param {number} options.maxQueueSize  - Max pending queue depth (default: 10)
   * @param {number} options.acquireTimeoutMs - Max wait time in queue (default: 120000 = 2 min)
   * @param {string} options.name - Name for logging/metrics
   */
  constructor({
    maxConcurrent = 3,
    maxQueueSize = 10,
    acquireTimeoutMs = 120000,
    name = 'semaphore',
  } = {}) {
    this.maxConcurrent = maxConcurrent;
    this.maxQueueSize = maxQueueSize;
    this.acquireTimeoutMs = acquireTimeoutMs;
    this.name = name;

    this._active = 0;
    this._queue = []; // Array of { resolve, reject, enqueuedAt, timer }
    this._totalAcquired = 0;
    this._totalRejected = 0;
    this._totalTimedOut = 0;
  }

  /**
   * Current number of active (running) operations.
   */
  get active() {
    return this._active;
  }

  /**
   * Current number of operations waiting in the queue.
   */
  get queued() {
    return this._queue.length;
  }

  /**
   * Acquire a permit. Resolves when a slot is available.
   * Rejects if the queue is full or the timeout is exceeded.
   *
   * @returns {Promise<{ release: Function, waitMs: number }>}
   */
  acquire() {
    // Fast path: slot available immediately
    if (this._active < this.maxConcurrent) {
      this._active++;
      this._totalAcquired++;
      const release = this._createRelease();
      return Promise.resolve({ release, waitMs: 0 });
    }

    // Queue is full — reject immediately
    if (this._queue.length >= this.maxQueueSize) {
      this._totalRejected++;
      logger.warn(`[${this.name}] Queue full — rejecting`, {
        active: this._active,
        queued: this._queue.length,
        maxConcurrent: this.maxConcurrent,
        maxQueueSize: this.maxQueueSize,
      });
      return Promise.reject(new SemaphoreRejectedError(
        `Provisioning queue is full (${this.maxQueueSize} waiting). Try again later.`,
        {
          active: this._active,
          queued: this._queue.length,
        }
      ));
    }

    // Enqueue and wait
    const enqueuedAt = Date.now();
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, enqueuedAt, timer: null };

      // Timeout guard
      entry.timer = setTimeout(() => {
        const idx = this._queue.indexOf(entry);
        if (idx !== -1) {
          this._queue.splice(idx, 1);
          this._totalTimedOut++;
          logger.warn(`[${this.name}] Queue wait timed out`, {
            waitMs: Date.now() - enqueuedAt,
            acquireTimeoutMs: this.acquireTimeoutMs,
          });
          reject(new SemaphoreTimeoutError(
            `Provisioning queue wait exceeded ${this.acquireTimeoutMs}ms timeout.`,
            { waitMs: Date.now() - enqueuedAt }
          ));
        }
      }, this.acquireTimeoutMs);

      this._queue.push(entry);

      logger.info(`[${this.name}] Queued — waiting for slot`, {
        position: this._queue.length,
        active: this._active,
        maxConcurrent: this.maxConcurrent,
      });
    });
  }

  /**
   * Create a one-shot release function.
   * Ensures each acquire() produces exactly one release() call.
   */
  _createRelease() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this._active--;
      this._processQueue();
    };
  }

  /**
   * Try to admit the next queued caller when a slot frees up.
   */
  _processQueue() {
    while (this._queue.length > 0 && this._active < this.maxConcurrent) {
      const entry = this._queue.shift();
      if (entry.timer) clearTimeout(entry.timer);

      this._active++;
      this._totalAcquired++;

      const waitMs = Date.now() - entry.enqueuedAt;
      const release = this._createRelease();

      logger.info(`[${this.name}] Dequeued — slot acquired`, {
        waitMs,
        active: this._active,
        remaining: this._queue.length,
      });

      entry.resolve({ release, waitMs });
    }
  }

  /**
   * Return snapshot of current stats for metrics/health checks.
   */
  stats() {
    return {
      active: this._active,
      queued: this._queue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueueSize: this.maxQueueSize,
      totalAcquired: this._totalAcquired,
      totalRejected: this._totalRejected,
      totalTimedOut: this._totalTimedOut,
    };
  }

  /**
   * Drain any pending entries (for graceful shutdown).
   */
  drain() {
    while (this._queue.length > 0) {
      const entry = this._queue.shift();
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(new SemaphoreRejectedError('Semaphore is shutting down.'));
    }
  }
}

// ─── Error Types ────────────────────────────────────────────────────────────

class SemaphoreRejectedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SemaphoreRejectedError';
    this.code = 'PROVISIONING_QUEUE_FULL';
    this.statusCode = 503;
    this.retryable = true;
    this.details = details;
  }
}

class SemaphoreTimeoutError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SemaphoreTimeoutError';
    this.code = 'PROVISIONING_QUEUE_TIMEOUT';
    this.statusCode = 503;
    this.retryable = true;
    this.details = details;
  }
}

module.exports = {
  Semaphore,
  SemaphoreRejectedError,
  SemaphoreTimeoutError,
};
