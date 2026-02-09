'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const logger = require('./utils/logger');
const requestContext = require('./middleware/requestContext');
const errorHandler = require('./middleware/errorHandler');
const storeRoutes = require('./routes/stores');
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const auditRoutes = require('./routes/audit');
const { runMigrations } = require('./db/migrate');
const db = require('./db/pool');
const provisionerService = require('./services/provisionerService');

/**
 * Multi-Tenant Ecommerce Control Plane — Express Application
 * 
 * Startup sequence:
 * 1. Run database migrations
 * 2. Recover any stores stuck in transitional states
 * 3. Start HTTP server
 * 
 * Shutdown sequence:
 * 1. Stop accepting new connections
 * 2. Wait for in-flight requests to complete
 * 3. Close database connections
 */

const app = express();

// ─── Security ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: config.isDev ? '*' : process.env.CORS_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-Request-ID', 'Authorization'],
}));

// ─── Rate Limiting ───────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.isDev ? 200 : 60, // requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please slow down.',
      suggestion: 'Wait a moment before retrying.',
      retryable: true,
    },
  },
});
app.use(limiter);

// ─── Body Parsing ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// ─── Request Context (tracing) ───────────────────────────────────────────────
app.use(requestContext);

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/stores', storeRoutes);
app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/audit', auditRoutes);

// Root endpoint — basic platform info
app.get('/', (req, res) => {
  res.json({
    name: 'Multi-Tenant Ecommerce Control Plane',
    version: '1.0.0',
    docs: '/api/v1/health',
    endpoints: {
      stores: '/api/v1/stores',
      health: '/api/v1/health',
    },
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    requestId: req.requestId,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found.`,
      suggestion: 'Check the API documentation for valid endpoints.',
      retryable: false,
    },
  });
});

// ─── Error Handler (must be last) ────────────────────────────────────────────
app.use(errorHandler);

// ─── Server Lifecycle ────────────────────────────────────────────────────────

let server;

async function start() {
  try {
    // 1. Run database migrations
    logger.info('Running database migrations...');
    await runMigrations();

    // 2. Recover stuck stores from any previous crash
    logger.info('Checking for stuck stores...');
    await provisionerService.recoverStuckStores();

    // 3. Start HTTP server
    server = app.listen(config.server.port, config.server.host, () => {
      logger.info(`Control plane started`, {
        port: config.server.port,
        host: config.server.host,
        env: config.env,
        maxStoresPerUser: config.provisioning.maxStoresPerUser,
      });
    });

    // Graceful shutdown handlers
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (err) {
    logger.error('Failed to start control plane', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

async function shutdown() {
  logger.info('Shutting down control plane...');

  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');
    });
  }

  // Close database pool
  await db.close();

  logger.info('Control plane shut down gracefully');
  process.exit(0);
}

// Start the server
start();

// Export for testing
module.exports = app;
