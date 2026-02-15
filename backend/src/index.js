'use strict';

// ─── Environment Validation (must run before config) ─────────────────────────
const { validateEnv } = require('./utils/envValidator');
const { warnings: envWarnings } = validateEnv();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const logger = require('./utils/logger');
const requestContext = require('./middleware/requestContext');
const requestTimeout = require('./middleware/requestTimeout');
const errorHandler = require('./middleware/errorHandler');
const { metricsMiddleware } = require('./utils/metrics');
const storeRoutes = require('./routes/stores');
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const auditRoutes = require('./routes/audit');
const metricsRoutes = require('./routes/metrics');
const { runMigrations } = require('./db/migrate');
const db = require('./db/pool');
const provisionerService = require('./services/provisionerService');
const ingressService = require('./services/ingressService');

// Log env validation warnings
envWarnings.forEach(w => logger.warn(w));

/**
 * Multi-Tenant Ecommerce Control Plane — Express Application
 * 
 * Startup sequence:
 * 1. Wait for database connectivity (with retries)
 * 2. Run database migrations
 * 3. Recover any stores stuck in transitional states
 * 4. Start HTTP server
 * 
 * Shutdown sequence:
 * 1. Stop accepting new connections
 * 2. Drain in-flight requests (max 15s)
 * 3. Close database connections
 */

const app = express();

// ─── Security ────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  hsts: {
    maxAge: 31536000,          // 1 year
    includeSubDomains: true,
    preload: true,
  },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: false, // Allow loading cross-origin resources (store assets)
}));

// CORS — restricted by domain in production
const corsOrigin = config.isDev
  ? '*'
  : (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: config.isDev ? '*' : corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-Request-ID', 'Authorization'],
  credentials: !config.isDev,
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
app.use(express.json({ limit: '256kb' })); // Reduced default; store routes can override
app.use(express.urlencoded({ extended: false, limit: '256kb' }));
// ─── Request Timeout (30s default, store provisioning gets 10 min) ───────────
app.use(requestTimeout(30000));
// ─── Metrics Middleware (before routes) ───────────────────────────────────────
app.use(metricsMiddleware);
// ─── Request Context (tracing) ───────────────────────────────────────────────
app.use(requestContext);

// ─── In-flight Request Tracking ──────────────────────────────────────────────
let inFlightRequests = 0;
let shuttingDown = false;

app.use((req, res, next) => {
  if (shuttingDown) {
    return res.status(503).json({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Server is shutting down. Please retry.',
        retryable: true,
      },
    });
  }
  inFlightRequests++;
  let counted = true;
  const decrement = () => {
    if (counted) { inFlightRequests--; counted = false; }
  };
  res.on('finish', decrement);
  res.on('close', decrement);
  next();
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/stores', storeRoutes);
app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/metrics', metricsRoutes);

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
    // 1. Wait for database connectivity (retries on cold start)
    logger.info('Waiting for database connection...');
    await db.waitForConnection();

    // 2. Run database migrations
    logger.info('Running database migrations...');
    await runMigrations();

    // 3. Recover stuck stores from any previous crash
    logger.info('Checking for stuck stores...');
    await provisionerService.recoverStuckStores();

    // 4. Start HTTP server
    server = app.listen(config.server.port, config.server.host, () => {
      logger.info(`Control plane started`, {
        port: config.server.port,
        host: config.server.host,
        env: config.env,
        ingressPort: config.store.ingressPort,
        autoPortForward: config.store.autoPortForward,
        maxStoresPerUser: config.provisioning.maxStoresPerUser,
      });
    });

    // 5. Start ingress port-forward (if configured for Docker Desktop)
    await ingressService.startPortForward();

    // Graceful shutdown handlers
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (err) {
    logger.error('Failed to start control plane', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

async function shutdown() {
  if (shuttingDown) return; // Prevent duplicate shutdown calls
  logger.info('Shutting down control plane...');
  shuttingDown = true;

  if (server) {
    // Stop accepting new connections
    server.close(() => {
      logger.info('HTTP server closed — no longer accepting connections');
    });

    // Wait for in-flight requests to drain (max 15s)
    const drainStart = Date.now();
    const maxDrainMs = 15000;
    while (inFlightRequests > 0 && (Date.now() - drainStart) < maxDrainMs) {
      logger.info(`Draining ${inFlightRequests} in-flight request(s)...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (inFlightRequests > 0) {
      logger.warn(`Force-closing with ${inFlightRequests} in-flight request(s) after ${maxDrainMs / 1000}s`);
    } else {
      logger.info('All in-flight requests drained');
    }
  }

  // Drain provisioning semaphore — reject queued operations waiting for a slot
  try {
    const { getConcurrencyStats } = provisionerService;
    const stats = getConcurrencyStats();
    if (stats.active > 0 || stats.queued > 0) {
      logger.info(`Draining provisioning semaphore: ${stats.active} active, ${stats.queued} queued`);
    }
  } catch {
    // Semaphore drain is best-effort
  }

  // Stop ingress port-forward
  ingressService.stopPortForward();

  // Close database pool (drains active queries)
  await db.close();

  logger.info('Control plane shut down gracefully');
  process.exit(0);
}

// Handle uncaught errors gracefully
process.on('unhandledRejection', (reason, _promise) => {
  logger.error('Unhandled promise rejection', {
    reason: reason?.message || String(reason),
    stack: reason?.stack,
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — shutting down', {
    error: err.message,
    stack: err.stack,
  });
  shutdown();
});

// Start the server
start();

// Export for testing
module.exports = app;
