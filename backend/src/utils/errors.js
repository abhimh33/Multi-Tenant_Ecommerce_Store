'use strict';

/**
 * Application-specific error classes.
 * Each error has a code (machine-readable), statusCode (HTTP),
 * message (human-readable), and suggestion (GenAI-friendly guidance).
 */

class AppError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {Object} options
   * @param {number} options.statusCode - HTTP status code
   * @param {string} options.code - Machine-readable error code
   * @param {string} [options.suggestion] - What the caller should do
   * @param {boolean} [options.retryable=false] - Whether the operation can be retried
   * @param {Object} [options.metadata] - Additional structured data
   */
  constructor(message, { statusCode = 500, code = 'INTERNAL_ERROR', suggestion, retryable = false, metadata } = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.suggestion = suggestion;
    this.retryable = retryable;
    this.metadata = metadata;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      suggestion: this.suggestion,
      retryable: this.retryable,
      ...(this.metadata ? { metadata: this.metadata } : {}),
    };
  }
}

class NotFoundError extends AppError {
  constructor(resource, id) {
    super(`${resource} '${id}' not found`, {
      statusCode: 404,
      code: `${resource.toUpperCase()}_NOT_FOUND`,
      suggestion: `Verify the ${resource.toLowerCase()} ID and try again.`,
    });
  }
}

class ConflictError extends AppError {
  constructor(message, suggestion) {
    super(message, {
      statusCode: 409,
      code: 'CONFLICT',
      suggestion,
    });
  }
}

class ValidationError extends AppError {
  constructor(message, details) {
    super(message, {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      suggestion: 'Check the request body and try again.',
      metadata: details,
    });
  }
}

class StoreLimitError extends AppError {
  constructor(limit) {
    super(`Maximum of ${limit} active stores per user reached.`, {
      statusCode: 429,
      code: 'STORE_LIMIT_EXCEEDED',
      suggestion: 'Delete an existing store before creating a new one.',
    });
  }
}

class InvalidStateTransitionError extends AppError {
  constructor(from, to, suggestion) {
    super(`Cannot transition store from '${from}' to '${to}'.`, {
      statusCode: 409,
      code: 'INVALID_STATE_TRANSITION',
      suggestion: suggestion || `The store is in '${from}' state. Check allowed transitions.`,
    });
  }
}

class ProvisioningError extends AppError {
  constructor(message, { retryable = true, metadata } = {}) {
    super(message, {
      statusCode: 500,
      code: 'PROVISIONING_ERROR',
      suggestion: retryable ? 'The operation may succeed if retried.' : 'Manual investigation may be required.',
      retryable,
      metadata,
    });
  }
}

class HelmError extends AppError {
  constructor(message, { retryable = true, metadata } = {}) {
    super(message, {
      statusCode: 500,
      code: 'HELM_ERROR',
      suggestion: 'Check Helm and Kubernetes cluster connectivity.',
      retryable,
      metadata,
    });
  }
}

class KubernetesError extends AppError {
  constructor(message, { retryable = true, metadata } = {}) {
    super(message, {
      statusCode: 500,
      code: 'KUBERNETES_ERROR',
      suggestion: 'Check Kubernetes cluster connectivity and permissions.',
      retryable,
      metadata,
    });
  }
}

module.exports = {
  AppError,
  NotFoundError,
  ConflictError,
  ValidationError,
  StoreLimitError,
  InvalidStateTransitionError,
  ProvisioningError,
  HelmError,
  KubernetesError,
};
