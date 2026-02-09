'use strict';

const { generateRequestId } = require('../utils/idGenerator');
const logger = require('../utils/logger').child('request');

/**
 * Request context middleware.
 * Assigns a unique request ID to every incoming request for traceability.
 * Logs request/response lifecycle.
 */
function requestContext(req, res, next) {
  // Use existing X-Request-ID header if provided (for load balancers, proxies)
  req.requestId = req.headers['x-request-id'] || generateRequestId();
  res.setHeader('X-Request-ID', req.requestId);

  const startTime = Date.now();

  // Log request
  logger.info('Incoming request', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    ip: req.ip,
  });

  // Log response on finish
  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
    logger[logLevel]('Request completed', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
    });
  });

  next();
}

module.exports = requestContext;
