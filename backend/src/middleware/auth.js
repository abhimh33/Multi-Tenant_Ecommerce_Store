'use strict';

const userService = require('../services/userService');
const logger = require('../utils/logger').child('auth');

/**
 * Verify JWT Bearer token and attach user to request.
 */
async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({
      requestId: req.requestId,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Please provide a valid Bearer token.',
        retryable: false,
      },
    });
  }

  try {
    const decoded = userService.verifyToken(token);
    const user = await userService.findById(decoded.id);

    if (!user || !user.isActive) {
      return res.status(401).json({
        requestId: req.requestId,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired token.',
          retryable: false,
        },
      });
    }

    req.user = user;
    next();
  } catch (err) {
    logger.warn('Token verification failed', { error: err.message });
    return res.status(401).json({
      requestId: req.requestId,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired token.',
        retryable: false,
      },
    });
  }
}

/**
 * Require the authenticated user to have one of the specified roles.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        requestId: req.requestId,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required.',
          retryable: false,
        },
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        requestId: req.requestId,
        error: {
          code: 'FORBIDDEN',
          message: `Access denied. Required role: ${roles.join(' or ')}.`,
          retryable: false,
        },
      });
    }

    next();
  };
}

module.exports = {
  authenticateToken,
  requireRole,
};
