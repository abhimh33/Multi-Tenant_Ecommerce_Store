'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/pool');
const k8sService = require('../services/kubernetesService');
const provisionerService = require('../services/provisionerService');

/**
 * Health Routes — /api/v1/health
 * 
 * Reports platform health including database and Kubernetes connectivity.
 * Designed to be consumed by monitoring systems and AI agents.
 * Includes response time measurements per dependency.
 */

router.get('/', async (req, res) => {
  const checks = {};

  // Database health (with latency measurement)
  const dbStart = Date.now();
  const dbHealthy = await db.healthCheck();
  const dbLatencyMs = Date.now() - dbStart;
  checks.database = dbHealthy
    ? { status: 'healthy', latencyMs: dbLatencyMs }
    : { status: 'unhealthy', message: 'Cannot connect to PostgreSQL', latencyMs: dbLatencyMs };

  // Kubernetes health (with latency measurement)
  const k8sStart = Date.now();
  const k8sHealth = await k8sService.healthCheck();
  const k8sLatencyMs = Date.now() - k8sStart;
  checks.kubernetes = k8sHealth.connected
    ? { status: 'healthy', context: k8sHealth.context, server: k8sHealth.server, latencyMs: k8sLatencyMs }
    : { status: 'unhealthy', message: k8sHealth.error || 'Cannot connect to Kubernetes cluster', latencyMs: k8sLatencyMs };

  const overallHealthy = Object.values(checks).every(c => c.status === 'healthy');

  // Include provisioning concurrency stats
  const concurrency = provisionerService.getConcurrencyStats();

  res.status(overallHealthy ? 200 : 503).json({
    requestId: req.requestId,
    status: overallHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    checks,
    concurrency,
  });
});

// Lightweight liveness probe (no dependency checks — always responds if process is alive)
router.get('/live', (req, res) => {
  res.status(200).json({ status: 'alive' });
});

/**
 * Readiness probe — returns 200 only when the service is fully operational.
 * Returns 503 during graceful shutdown so load balancers stop routing to this instance.
 * Suitable for: Kubernetes readinessProbe, HAProxy health checks, pm2 ready signal.
 */
router.get('/ready', async (req, res) => {
  // During shutdown, report not-ready immediately
  if (process.exitCode !== undefined) {
    return res.status(503).json({ status: 'shutting-down', ready: false });
  }

  const dbHealthy = await db.healthCheck();
  const ready = dbHealthy; // DB is the minimum requirement for readiness

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not-ready',
    ready,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
