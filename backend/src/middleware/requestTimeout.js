'use strict';

const logger = require('../utils/logger').child('timeout');

/**
 * Request timeout middleware.
 * Aborts requests that exceed the configured timeout.
 * 
 * @param {number} timeoutMs - Timeout in milliseconds (default: 30s)
 * @returns {Function} Express middleware
 */
function requestTimeout(timeoutMs = 30000) {
  return (req, res, next) => {
    // Set the server-side socket timeout
    req.setTimeout(timeoutMs);

    const timer = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn('Request timed out', {
          requestId: req.requestId,
          method: req.method,
          path: req.path,
          timeoutMs,
        });
        res.status(408).json({
          requestId: req.requestId,
          error: {
            code: 'REQUEST_TIMEOUT',
            message: `Request timed out after ${timeoutMs / 1000} seconds.`,
            suggestion: 'Try again. If the problem persists, the operation may require more time.',
            retryable: true,
          },
        });
      }
    }, timeoutMs);

    // Clear timer when response finishes (success or error)
    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));

    next();
  };
}

module.exports = requestTimeout;
