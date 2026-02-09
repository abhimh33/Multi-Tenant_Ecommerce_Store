'use strict';

const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');
const { validate, registerSchema, loginSchema } = require('../middleware/validators');

// POST /api/v1/auth/register
router.post(
  '/register',
  validate(registerSchema, 'body'),
  authController.register
);

// POST /api/v1/auth/login
router.post(
  '/login',
  validate(loginSchema, 'body'),
  authController.login
);

// GET /api/v1/auth/me  (requires authentication)
router.get(
  '/me',
  authenticateToken,
  authController.me
);

module.exports = router;
