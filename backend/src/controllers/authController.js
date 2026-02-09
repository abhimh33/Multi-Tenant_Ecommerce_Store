'use strict';

const userService = require('../services/userService');
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

module.exports = {
  register,
  login,
  me,
};
