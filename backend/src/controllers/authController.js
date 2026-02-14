'use strict';

const userService = require('../services/userService');
const storeRegistry = require('../services/storeRegistry');
const storeSetupService = require('../services/storeSetupService');
const auditService = require('../services/auditService');
const { recordFailedAttempt, clearLockout } = require('../middleware/loginLimiter');
const logger = require('../utils/logger').child('auth-controller');
const { securityEvents } = require('../utils/metrics');

async function register(req, res, next) {
  try {
    const { email, username, password } = req.body;

    // Check for existing user by email
    const existing = await userService.findByEmail(email);
    if (existing) {
      return res.status(409).json({
        requestId: req.requestId,
        error: {
          code: 'USER_EXISTS',
          message: 'A user with this email already exists.',
          retryable: false,
        },
      });
    }

    // First registered user is always admin
    const userCount = await userService.countUsers();
    const role = userCount === 0 ? 'admin' : 'tenant';

    const user = await userService.register({ email, username, password, role });
    const token = userService.generateToken(user);

    logger.info('User registered', { userId: user.id, email: user.email, role });

    // Audit security event
    securityEvents.inc({ event_type: 'registration' });
    auditService.logSecurityEvent({
      action: 'registration',
      email: user.email,
      ip: req.ip,
      message: `New user registered: ${user.email} (role: ${role})`,
      metadata: { userId: user.id, role },
    }).catch(() => {}); // non-blocking

    res.status(201).json({
      requestId: req.requestId,
      message: 'Registration successful.',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
      token,
    });
  } catch (err) {
    // Handle unique constraint violations
    if (err.code === '23505') {
      return res.status(409).json({
        requestId: req.requestId,
        error: {
          code: 'USER_EXISTS',
          message: 'A user with this email or username already exists.',
          retryable: false,
        },
      });
    }
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    const user = await userService.authenticate({ email, password });

    if (!user) {
      recordFailedAttempt(email);

      // Audit failed login
      securityEvents.inc({ event_type: 'login_failed' });
      auditService.logSecurityEvent({
        action: 'login_failed',
        email,
        ip: req.ip,
        message: `Failed login attempt for ${email}`,
      }).catch(() => {}); // non-blocking

      return res.status(401).json({
        requestId: req.requestId,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.',
          retryable: false,
        },
      });
    }

    // Successful login — clear any lockout state
    clearLockout(email);
    const token = userService.generateToken(user);

    logger.info('User logged in', { userId: user.id, email: user.email });

    // Audit successful login
    securityEvents.inc({ event_type: 'login_success' });
    auditService.logSecurityEvent({
      action: 'login_success',
      email: user.email,
      ip: req.ip,
      message: `Successful login for ${user.email}`,
      metadata: { userId: user.id },
    }).catch(() => {}); // non-blocking

    res.json({
      requestId: req.requestId,
      message: 'Login successful.',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
      token,
    });
  } catch (err) {
    next(err);
  }
}

async function me(req, res) {
  res.json({
    requestId: req.requestId,
    user: {
      id: req.user.id,
      email: req.user.email,
      username: req.user.username,
      role: req.user.role,
      createdAt: req.user.createdAt,
    },
  });
}

/**
 * PATCH /api/v1/auth/password
 * Change the authenticated user's password and propagate to all owned Medusa stores.
 */
async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    // 1. Update control-plane password
    await userService.changePassword(userId, currentPassword, newPassword);

    // 2. Propagate to all owned stores that are ready (both engines)
    const { stores } = await storeRegistry.list({
      ownerId: userId,
      status: 'ready',
      limit: 100,
      offset: 0,
    });

    const propagationResults = [];
    for (const store of stores) {
      try {
        const creds = store.adminCredentials;
        if (!creds || !creds.email) {
          logger.warn('Store missing admin credentials, skipping propagation', { storeId: store.id });
          propagationResults.push({ storeId: store.id, success: false, reason: 'no credentials' });
          continue;
        }

        let success = false;

        if (store.engine === 'medusa') {
          success = await storeSetupService.updateMedusaAdminPassword({
            namespace: store.namespace,
            storeId: store.id,
            adminEmail: creds.email,
            currentPassword: creds.password,
            newPassword,
          });
        } else if (store.engine === 'woocommerce') {
          success = await storeSetupService.updateWooCommerceAdminPassword({
            namespace: store.namespace,
            storeId: store.id,
            adminUsername: creds.username || 'admin',
            newPassword,
          });
        }

        if (success) {
          // Update stored credentials with new password
          await storeRegistry.update(store.id, {
            adminCredentials: { ...creds, password: newPassword },
          });
        }

        propagationResults.push({ storeId: store.id, success });
      } catch (err) {
        logger.warn('Password propagation failed for store', { storeId: store.id, error: err.message });
        propagationResults.push({ storeId: store.id, success: false, reason: err.message });
      }
    }

    logger.info('Password changed and propagated', {
      userId,
      totalStores: stores.length,
      successful: propagationResults.filter(r => r.success).length,
    });

    res.json({
      requestId: req.requestId,
      message: 'Password changed successfully.',
      propagation: {
        totalStores: stores.length,
        successful: propagationResults.filter(r => r.success).length,
        failed: propagationResults.filter(r => !r.success).length,
        details: propagationResults,
      },
    });
  } catch (err) {
    if (err.message === 'Current password is incorrect') {
      return res.status(401).json({
        requestId: req.requestId,
        error: {
          code: 'INVALID_PASSWORD',
          message: 'Current password is incorrect.',
          retryable: false,
        },
      });
    }
    next(err);
  }
}

module.exports = {
  register,
  login,
  me,
  changePassword,
};
