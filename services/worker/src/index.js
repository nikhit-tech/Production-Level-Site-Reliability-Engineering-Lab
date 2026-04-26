const Queue = require('bull');
const Redis = require('ioredis');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const { CronJob } = require('cron');   // package.json has 'cron', not 'node-cron'
const promClient = require('prom-client');
const winston = require('winston');
require('dotenv').config();

// Fail fast on missing required secrets
if (!process.env.DB_PASSWORD) {
  console.error('FATAL: DB_PASSWORD environment variable is not set. Refusing to start.');
  process.exit(1);
}

// Logging — stdout only in containers
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

// Prometheus metrics
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

const queueJobsTotal = new promClient.Counter({
  name: 'queue_jobs_total',
  help: 'Total number of jobs processed',
  labelNames: ['queue', 'status'],
  registers: [register],
});

const queueJobsDuration = new promClient.Histogram({
  name: 'queue_job_duration_seconds',
  help: 'Duration of job processing',
  labelNames: ['queue', 'job_type'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [register],
});

const activeJobs = new promClient.Gauge({
  name: 'queue_active_jobs',
  help: 'Number of active jobs',
  labelNames: ['queue'],
  registers: [register],
});

// Redis connection (shared by Bull queues and health checks)
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
};

const redisConnection = new Redis(redisConfig);

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  database: process.env.DB_NAME || 'ecommerce',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,
});

// Email transporter
const emailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: parseInt(process.env.SMTP_PORT, 10) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});

const queueDefaults = {
  redis: redisConfig,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  },
};

const emailQueue           = new Queue('email sending',       { ...queueDefaults, defaultJobOptions: { ...queueDefaults.defaultJobOptions } });
const orderProcessingQueue = new Queue('order processing',    { ...queueDefaults, defaultJobOptions: { ...queueDefaults.defaultJobOptions, backoff: { type: 'exponential', delay: 5000 } } });
const inventoryQueue       = new Queue('inventory management',{ ...queueDefaults, defaultJobOptions: { ...queueDefaults.defaultJobOptions, attempts: 2, backoff: { type: 'exponential', delay: 3000 } } });

// ─── Email worker ────────────────────────────────────────────────────────────
emailQueue.process('send-email', async (job) => {
  const startTime = Date.now();
  activeJobs.labels('email').inc();

  try {
    const { to, subject, html, text } = job.data;

    if (process.env.SMTP_HOST && process.env.SMTP_HOST !== 'localhost') {
      await emailTransporter.sendMail({ from: process.env.SMTP_FROM || 'noreply@ecommerce.local', to, subject, html, text });
    } else {
      // Simulate in dev/staging when no real SMTP is configured
      await new Promise(r => setTimeout(r, Math.random() * 1000 + 500));
    }

    logger.info(`Email sent to ${to}`, { subject, jobId: job.id });
    queueJobsDuration.labels('email', 'send-email').observe((Date.now() - startTime) / 1000);
    queueJobsTotal.labels('email', 'completed').inc();
    return { success: true, messageId: `msg_${Date.now()}` };
  } catch (error) {
    logger.error(`Failed to send email to ${job.data.to}`, { error: error.message, jobId: job.id });
    queueJobsTotal.labels('email', 'failed').inc();
    throw error;
  } finally {
    activeJobs.labels('email').dec();
  }
});

// ─── Order processing worker ─────────────────────────────────────────────────
orderProcessingQueue.process('process-order', async (job) => {
  const startTime = Date.now();
  activeJobs.labels('order').inc();

  try {
    const { orderId, userId, items } = job.data;

    // Fetch user email from DB so we send to the real customer, not a placeholder
    const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    const customerEmail = userResult.rows[0]?.email;

    const result = await pool.query(
      'UPDATE orders SET status=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING *',
      ['confirmed', orderId]
    );
    if (result.rows.length === 0) throw new Error(`Order ${orderId} not found`);

    if (customerEmail) {
      await emailQueue.add('send-email', {
        to: customerEmail,
        subject: `Order #${orderId} Confirmed`,
        text: `Your order has been confirmed. Items: ${items?.length || 0}`,
      });
    }

    logger.info(`Order processed: ${orderId}`, { userId, itemCount: items?.length });
    queueJobsDuration.labels('order', 'process-order').observe((Date.now() - startTime) / 1000);
    queueJobsTotal.labels('order', 'completed').inc();
    return { success: true, orderId, status: 'confirmed' };
  } catch (error) {
    logger.error(`Failed to process order ${job.data.orderId}`, { error: error.message, jobId: job.id });
    queueJobsTotal.labels('order', 'failed').inc();
    throw error;
  } finally {
    activeJobs.labels('order').dec();
  }
});

// ─── Inventory worker ─────────────────────────────────────────────────────────
inventoryQueue.process('update-inventory', async (job) => {
  const startTime = Date.now();
  activeJobs.labels('inventory').inc();

  try {
    const { productId, quantityChange, reason } = job.data;

    const result = await pool.query(
      'UPDATE products SET stock_quantity = stock_quantity + $1, updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING stock_quantity',
      [quantityChange, productId]
    );
    if (result.rows.length === 0) throw new Error(`Product ${productId} not found`);

    const newStock = result.rows[0].stock_quantity;

    if (newStock < 10) {
      const opsEmail = process.env.INVENTORY_ALERT_EMAIL || 'inventory@ecommerce.local';
      await emailQueue.add('send-email', {
        to: opsEmail,
        subject: `Low Stock Alert: Product ${productId}`,
        text: `Product ${productId} has only ${newStock} units remaining.`,
      });
    }

    logger.info(`Inventory updated: ${productId}`, { quantityChange, reason, newStock });
    queueJobsDuration.labels('inventory', 'update-inventory').observe((Date.now() - startTime) / 1000);
    queueJobsTotal.labels('inventory', 'completed').inc();
    return { success: true, productId, newStock };
  } catch (error) {
    logger.error(`Failed to update inventory ${job.data.productId}`, { error: error.message, jobId: job.id });
    queueJobsTotal.labels('inventory', 'failed').inc();
    throw error;
  } finally {
    activeJobs.labels('inventory').dec();
  }
});

// ─── Scheduled tasks ──────────────────────────────────────────────────────────

// Daily inventory check — 4th arg false = don't auto-start
const dailyInventoryCheck = new CronJob('0 2 * * *', async () => {
  try {
    logger.info('Running daily inventory check');
    const result = await pool.query(
      'SELECT id, name, stock_quantity, category FROM products WHERE stock_quantity < 10 ORDER BY stock_quantity ASC'
    );
    if (result.rows.length > 0) {
      const opsEmail = process.env.INVENTORY_ALERT_EMAIL || 'inventory@ecommerce.local';
      await emailQueue.add('send-email', {
        to: opsEmail,
        subject: 'Daily Low Stock Report',
        text: `${result.rows.length} items are low on stock:\n${result.rows.map(r => `${r.name}: ${r.stock_quantity}`).join('\n')}`,
      });
      logger.info(`Found ${result.rows.length} low stock items`);
    }
  } catch (error) {
    logger.error('Daily inventory check failed', { error: error.message });
  }
}, null, false);

// Weekly order summary — Sundays at 9 AM
const weeklyOrderSummary = new CronJob('0 9 * * 0', async () => {
  try {
    logger.info('Running weekly order summary');
    const result = await pool.query(`
      SELECT COUNT(*) as total_orders,
             COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_orders,
             COALESCE(SUM(total_amount), 0) as total_revenue,
             DATE(created_at) as order_date
      FROM orders
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at)
      ORDER BY order_date DESC
    `);
    if (result.rows.length > 0) {
      const reportsEmail = process.env.REPORTS_EMAIL || 'reports@ecommerce.local';
      await emailQueue.add('send-email', {
        to: reportsEmail,
        subject: 'Weekly Order Summary',
        text: `Weekly summary: ${JSON.stringify(result.rows, null, 2)}`,
      });
      logger.info(`Generated weekly summary with ${result.rows.length} days of data`);
    }
  } catch (error) {
    logger.error('Weekly order summary failed', { error: error.message });
  }
}, null, false);

// ─── Health check ─────────────────────────────────────────────────────────────
const healthCheck = async () => {
  try {
    await redisConnection.ping();
    await pool.query('SELECT 1');

    const [emailWaiting, orderWaiting, inventoryWaiting] = await Promise.all([
      emailQueue.getWaiting(),
      orderProcessingQueue.getWaiting(),
      inventoryQueue.getWaiting(),
    ]);

    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      queues: {
        email:     { waiting: emailWaiting.length },
        order:     { waiting: orderWaiting.length },
        inventory: { waiting: inventoryWaiting.length },
      },
      uptime: process.uptime(),
    };
  } catch (error) {
    return { status: 'unhealthy', error: error.message, timestamp: new Date().toISOString() };
  }
};

// ─── Metrics/health HTTP server ───────────────────────────────────────────────
const setupMetricsServer = () => {
  const express = require('express');
  const app = express();

  app.get('/health', async (req, res) => {
    const health = await healthCheck();
    res.status(health.status === 'healthy' ? 200 : 503).json(health);
  });

  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  const port = parseInt(process.env.METRICS_PORT, 10) || 3002;
  app.listen(port, () => logger.info(`Metrics server running on port ${port}`));
};

// ─── Graceful shutdown ────────────────────────────────────────────────────────
const gracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}, starting graceful shutdown`);
  try {
    dailyInventoryCheck.stop();
    weeklyOrderSummary.stop();

    await emailQueue.close();
    await orderProcessingQueue.close();
    await inventoryQueue.close();

    await pool.end();
    await redisConnection.quit();

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
};

// ─── Startup ──────────────────────────────────────────────────────────────────
const startWorker = async () => {
  // Retry DB connection — Postgres may start slower than the worker in Kubernetes
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await pool.query('SELECT 1');
      logger.info('Database connected');
      break;
    } catch (err) {
      if (attempt === 10) { logger.error('Cannot connect to database after 10 attempts'); process.exit(1); }
      const delay = 2000 * attempt;
      logger.warn(`DB attempt ${attempt}/10 failed — retrying in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  await redisConnection.ping();
  logger.info('Redis connected');

  dailyInventoryCheck.start();
  weeklyOrderSummary.start();
  logger.info('Cron jobs started');

  setupMetricsServer();
  logger.info('Worker service started successfully');

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
};

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', { reason });
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

module.exports = { emailQueue, orderProcessingQueue, inventoryQueue, healthCheck };

if (require.main === module) {
  startWorker();
}
