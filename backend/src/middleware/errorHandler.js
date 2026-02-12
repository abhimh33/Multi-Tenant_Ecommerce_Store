'use strict';

const logger = require('../utils/logger').child('error-handler');
const { AppError } = require('../utils/errors');
const { generateRequestId } = require('../utils/idGenerator');

/**
 * Centralized error handling middleware.
 * Formats all errors into a consistent, GenAI-friendly JSON structure.
 * 
 * Response format:
 * {
 *   "requestId": "req_abc123",
 *   "error": {
 *     "code": "MACHINE_READABLE_CODE",
 *     "message": "Human-readable description",
 *     "suggestion": "What to do about it",
 *     "retryable": true/false
 *   }
 * }
 */

function errorHandler(err, req, res, _next) {
  const requestId = req.requestId || generateRequestId();

  // Known application errors
  if (err instanceof AppError) {
    logger.warn('Application error', {
      requestId,
      code: err.code,
      message: err.message,
      statusCode: err.statusCode,
      path: req.path,
    });

    return res.status(err.statusCode).json({
      requestId,
      error: err.toJSON(),
    });
  }

  // Joi validation errors
  if (err.isJoi || err.name === 'ValidationError') {
    logger.warn('Validation error', {
      requestId,
      message: err.message,
      path: req.path,
    });

    return res.status(400).json({
      requestId,
      error: {
        code: 'VALIDATION_ERROR',
        message: err.message,
        suggestion: 'Check the request parameters and try again.',
        retryable: false,
        details: err.details || undefined,
      },
    });
  }

  // State transition errors from store machine
  if (err.code === 'INVALID_STATE_TRANSITION') {
    return res.status(409).json({
      requestId,
      error: {
        code: err.code,
        message: err.message,
        suggestion: 'The store is not in the correct state for this operation.',
        retryable: false,
      },
    });
  }

  // Unexpected errors — log full stack, return safe message
  logger.error('Unhandled error', {
    requestId,
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  return res.status(500).json({
    requestId,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      suggestion: 'Try again later. If the problem persists, contact support.',
      retryable: true,
    },
  });
}

module.exports = errorHandler;
