'use strict';

const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');
const { validate, registerSchema, loginSchema, changePasswordSchema } = require('../middleware/validators');
const { loginLimiter, registerLimiter } = require('../middleware/loginLimiter');

// POST /api/v1/auth/register (rate limited: 5/hour per IP)
router.post(
  '/register',
  registerLimiter,
  validate(registerSchema, 'body'),
  authController.register
);

// POST /api/v1/auth/login (rate limited: 10/15min per IP+email)
router.post(
  '/login',
  loginLimiter,
  validate(loginSchema, 'body'),
  authController.login
);

// GET /api/v1/auth/me  (requires authentication)
router.get(
  '/me',
  authenticateToken,
  authController.me
);

// PATCH /api/v1/auth/password  (requires authentication)
router.patch(
  '/password',
  authenticateToken,
  validate(changePasswordSchema, 'body'),
  authController.changePassword
);

module.exports = router;
