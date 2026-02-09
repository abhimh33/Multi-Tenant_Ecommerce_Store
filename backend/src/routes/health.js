'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/pool');
const k8sService = require('../services/kubernetesService');

/**
 * Health Routes — /api/v1/health
 * 
 * Reports platform health including database and Kubernetes connectivity.
 * Designed to be consumed by monitoring systems and AI agents.
 */

router.get('/', async (req, res) => {
  const checks = {};

  // Database health
  checks.database = await db.healthCheck()
    ? { status: 'healthy' }
    : { status: 'unhealthy', message: 'Cannot connect to PostgreSQL' };

  // Kubernetes health
  const k8sHealth = await k8sService.healthCheck();
  checks.kubernetes = k8sHealth.connected
    ? { status: 'healthy', context: k8sHealth.context, server: k8sHealth.server }
    : { status: 'unhealthy', message: k8sHealth.error || 'Cannot connect to Kubernetes cluster' };

  const overallHealthy = Object.values(checks).every(c => c.status === 'healthy');

  res.status(overallHealthy ? 200 : 503).json({
    requestId: req.requestId,
    status: overallHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  });
});

module.exports = router;
