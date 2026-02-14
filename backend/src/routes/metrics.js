'use strict';

const express = require('express');
const router = express.Router();
const { serializeMetrics } = require('../utils/metrics');
const { getAllStats } = require('../utils/circuitBreaker');
const { authenticateToken, requireRole } = require('../middleware/auth');

/**
 * Metrics Routes — /api/v1/metrics
 * 
 * Prometheus-compatible metrics endpoint.
 * Protected by authentication — only admins can access.
 * 
 * Also exposes a JSON summary endpoint for human consumption.
 */

// All metrics routes require admin authentication
router.use(authenticateToken);
router.use(requireRole('admin'));

// GET /api/v1/metrics — Prometheus text format
router.get('/', (req, res) => {
  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(serializeMetrics());
});

// GET /api/v1/metrics/json — JSON summary for dashboards
router.get('/json', (req, res) => {
  const circuitBreakers = getAllStats();

  res.json({
    requestId: req.requestId,
    uptime: Math.floor(process.uptime()),
    memoryUsage: process.memoryUsage(),
    cpuUsage: process.cpuUsage(),
    circuitBreakers,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
