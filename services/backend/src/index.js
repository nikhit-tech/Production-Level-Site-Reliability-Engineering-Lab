const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const promClient = require('prom-client');
const winston = require('winston');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Fail fast on missing required secrets — prevents starting with insecure defaults
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
  process.exit(1);
}
if (!process.env.DB_PASSWORD) {
  console.error('FATAL: DB_PASSWORD environment variable is not set. Refusing to start.');
  process.exit(1);
}

const { initDatabase } = require('./database/connection');
const { initRedis } = require('./redis/connection');
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const userRoutes = require('./routes/users');
const healthRoutes = require('./routes/health');

// Ensure logs directory exists for non-production file transports
if (process.env.NODE_ENV !== 'production') {
  fs.mkdirSync('logs', { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 8080;

// Logging — in containers log to stdout only; file transport for local dev
const logTransports = [new winston.transports.Console()];
if (process.env.NODE_ENV !== 'production') {
  logTransports.push(new winston.transports.File({ filename: 'logs/error.log', level: 'error' }));
  logTransports.push(new winston.transports.File({ filename: 'logs/combined.log' }));
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: logTransports,
});

// Prometheus metrics — explicit registry so health.js metrics don't clash
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

const httpRequestTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const activeConnections = new promClient.Gauge({
  name: 'active_connections',
  help: 'Number of active HTTP connections',
  registers: [register],
});

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()) || ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID'],
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Correlation ID — propagated from upstream or generated fresh
app.use((req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || uuidv4();
  res.setHeader('x-correlation-id', req.correlationId);
  next();
});

// Rate limiting — general API limit
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again later' },
});

// Stricter auth limiter — prevents credential stuffing
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many authentication attempts, please try again later' },
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Request metrics and structured logging
app.use((req, res, next) => {
  activeConnections.inc();
  const start = Date.now();

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route ? req.route.path : req.path;

    httpRequestDuration.labels(req.method, route, String(res.statusCode)).observe(duration);
    httpRequestTotal.labels(req.method, route, String(res.statusCode)).inc();
    activeConnections.dec();

    logger.info('HTTP Request', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration,
      correlationId: req.correlationId,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
    });
  });

  next();
});

// Lightweight liveness endpoint — no DB/Redis dependency
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

// Metrics endpoint — restricted to Prometheus scraper IPs
app.get('/metrics', (req, res, next) => {
  const allowedIPs = process.env.METRICS_ALLOWED_IPS?.split(',').map(s => s.trim())
    || ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  if (process.env.NODE_ENV !== 'development' && !allowedIPs.includes(req.ip)) {
    return res.status(403).end();
  }
  next();
}, async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/users', userRoutes);
app.use('/api/health', healthRoutes);

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    correlationId: req.correlationId,
  });

  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: 'Validation Error', details: err.details });
  }
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    correlationId: req.correlationId,
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Not Found', message: `Route ${req.originalUrl} not found` });
});

// Hoisted so gracefulShutdown can reference it regardless of startup timing
let server;

const gracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}, starting graceful shutdown`);

  server.close(async () => {
    logger.info('HTTP server closed');
    try {
      const { getPool } = require('./database/connection');
      await getPool().end();
      logger.info('Database connections closed');

      const { getRedisClient } = require('./redis/connection');
      await getRedisClient().quit();
      logger.info('Redis connection closed');

      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  });

  // Force kill if graceful shutdown exceeds 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

const startServer = async () => {
  try {
    await initDatabase();
    logger.info('Database initialized');

    await initRedis();
    logger.info('Redis initialized');

    server = app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Health check: http://localhost:${PORT}/health`);
      logger.info(`Metrics: http://localhost:${PORT}/metrics`);
    });

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;
