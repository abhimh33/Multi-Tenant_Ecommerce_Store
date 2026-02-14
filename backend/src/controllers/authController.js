'use strict';

const userService = require('../services/userService');
const storeRegistry = require('../services/storeRegistry');
const storeSetupService = require('../services/storeSetupService');
const logger = require('../utils/logger').child('auth-controller');

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
      return res.status(401).json({
        requestId: req.requestId,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.',
          retryable: false,
        },
      });
    }

    const token = userService.generateToken(user);

    logger.info('User logged in', { userId: user.id, email: user.email });

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

    // 2. Propagate to all owned Medusa stores that are ready
    const { stores } = await storeRegistry.list({
      ownerId: userId,
      engine: 'medusa',
      status: 'ready',
      limit: 100,
      offset: 0,
    });

    const propagationResults = [];
    for (const store of stores) {
      try {
        const creds = store.adminCredentials;
        if (!creds || !creds.adminEmail) {
          logger.warn('Store missing admin credentials, skipping propagation', { storeId: store.id });
          propagationResults.push({ storeId: store.id, success: false, reason: 'no credentials' });
          continue;
        }

        const success = await storeSetupService.updateMedusaAdminPassword({
          namespace: store.namespace,
          storeId: store.id,
          adminEmail: creds.adminEmail,
          currentPassword,
          newPassword,
        });

        if (success) {
          // Update stored credentials with new password
          await storeRegistry.update(store.id, {
            adminCredentials: { ...creds, adminPassword: newPassword },
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
