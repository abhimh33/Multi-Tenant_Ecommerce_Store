'use strict';

const express = require('express');
const router = express.Router();

const storeController = require('../controllers/storeController');
const { authenticateToken } = require('../middleware/auth');
const { validate, createStoreSchema, listStoresSchema, storeIdSchema, logsQuerySchema } = require('../middleware/validators');

// All store routes require authentication
router.use(authenticateToken);

/**
 * Store Routes — /api/v1/stores
 * 
 * All routes are RESTful, idempotent-safe, and designed for GenAI invocation.
 * Every response includes a requestId for traceability.
 */

// Create a new store
router.post(
  '/',
  validate(createStoreSchema, 'body'),
  storeController.createStore
);

// List all stores
router.get(
  '/',
  validate(listStoresSchema, 'query'),
  storeController.listStores
);

// Get a single store
router.get(
  '/:id',
  validate(storeIdSchema, 'params'),
  storeController.getStore
);

// Delete a store
router.delete(
  '/:id',
  validate(storeIdSchema, 'params'),
  storeController.deleteStore
);

// Retry a failed store
router.post(
  '/:id/retry',
  validate(storeIdSchema, 'params'),
  storeController.retryStore
);

// Get store activity logs
router.get(
  '/:id/logs',
  validate(storeIdSchema, 'params'),
  validate(logsQuerySchema, 'query'),
  storeController.getStoreLogs
);

module.exports = router;
