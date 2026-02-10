const Queue = require('bull');
const Redis = require('ioredis');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const { CronJob } = cron;
const promClient = require('prom-client');
const winston = require('winston');
require('dotenv').config();

// Configure logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    }),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

// Prometheus metrics
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

const queueJobsTotal = new promClient.Counter({
  name: 'queue_jobs_total',
  help: 'Total number of jobs processed',
  labelNames: ['queue', 'status']
});

const queueJobsDuration = new promClient.Histogram({
  name: 'queue_job_duration_seconds',
  help: 'Duration of job processing',
  labelNames: ['queue', 'job_type'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60]
});

const activeJobs = new promClient.Gauge({
  name: 'queue_active_jobs',
  help: 'Number of active jobs',
  labelNames: ['queue']
});

register.registerMetric(queueJobsTotal);
register.registerMetric(queueJobsDuration);
register.registerMetric(activeJobs);

// Redis connection
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  retryDelayOnClusterDown: 300,
};

const redisConnection = new Redis(redisConfig);

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'ecommerce',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Email transporter
const emailTransporter = nodemailer.createTransporter({
  host: process.env.SMTP_HOST || 'localhost',
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  }
});

// Create queues
const emailQueue = new Queue('email sending', {
  redis: redisConfig,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

const orderProcessingQueue = new Queue('order processing', {
  redis: redisConfig,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  },
});

const inventoryQueue = new Queue('inventory management', {
  redis: redisConfig,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 3000,
    },
  },
});

// Email sending worker
emailQueue.process('send-email', async (job) => {
  const startTime = Date.now();
  activeJobs.labels('email').inc();
  
  try {
    const { to, subject, html, text, templateData } = job.data;
    
    // Simulate email sending (in production, this would actually send)
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
    
    logger.info(`Email sent to ${to}`, {
      subject,
      jobId: job.id,
      templateData
    });
    
    const duration = (Date.now() - startTime) / 1000;
    queueJobsDuration.labels('email', 'send-email').observe(duration);
    queueJobsTotal.labels('email', 'completed').inc();
    
    return { success: true, messageId: `msg_${Date.now()}` };
    
  } catch (error) {
    logger.error(`Failed to send email to ${job.data.to}`, {
      error: error.message,
      jobId: job.id
    });
    
    queueJobsTotal.labels('email', 'failed').inc();
    throw error;
    
  } finally {
    activeJobs.labels('email').dec();
  }
});

// Order processing worker
orderProcessingQueue.process('process-order', async (job) => {
  const startTime = Date.now();
  activeJobs.labels('order').inc();
  
  try {
    const { orderId, userId, items } = job.data;
    
    // Simulate order processing
    await new Promise(resolve => setTimeout(resolve, Math.random() * 3000 + 2000));
    
    // Update order status in database
    const result = await pool.query(
      'UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      ['confirmed', orderId]
    );
    
    if (result.rows.length === 0) {
      throw new Error(`Order ${orderId} not found`);
    }
    
    // Add email notification job
    await emailQueue.add('send-email', {
      to: 'customer@example.com', // Would get from database
      subject: `Order #${orderId} Confirmed`,
      template: 'order-confirmation',
      templateData: { orderId, items }
    });
    
    logger.info(`Order processed: ${orderId}`, {
      userId,
      itemCount: items.length
    });
    
    const duration = (Date.now() - startTime) / 1000;
    queueJobsDuration.labels('order', 'process-order').observe(duration);
    queueJobsTotal.labels('order', 'completed').inc();
    
    return { success: true, orderId, status: 'confirmed' };
    
  } catch (error) {
    logger.error(`Failed to process order ${job.data.orderId}`, {
      error: error.message,
      jobId: job.id
    });
    
    queueJobsTotal.labels('order', 'failed').inc();
    throw error;
    
  } finally {
    activeJobs.labels('order').dec();
  }
});

// Inventory management worker
inventoryQueue.process('update-inventory', async (job) => {
  const startTime = Date.now();
  activeJobs.labels('inventory').inc();
  
  try {
    const { productId, quantityChange, reason } = job.data;
    
    // Update product inventory
    const result = await pool.query(
      'UPDATE products SET stock_quantity = stock_quantity + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING stock_quantity',
      [quantityChange, productId]
    );
    
    if (result.rows.length === 0) {
      throw new Error(`Product ${productId} not found`);
    }
    
    const newStock = result.rows[0].stock_quantity;
    
    // Check if stock is low and send alert
    if (newStock < 10) {
      await emailQueue.add('send-email', {
        to: 'inventory@example.com',
        subject: `Low Stock Alert: ${productId}`,
        template: 'low-stock',
        templateData: { productId, newStock }
      });
    }
    
    logger.info(`Inventory updated: ${productId}`, {
      quantityChange,
      reason,
      newStock
    });
    
    const duration = (Date.now() - startTime) / 1000;
    queueJobsDuration.labels('inventory', 'update-inventory').observe(duration);
    queueJobsTotal.labels('inventory', 'completed').inc();
    
    return { success: true, productId, newStock };
    
  } catch (error) {
    logger.error(`Failed to update inventory ${job.data.productId}`, {
      error: error.message,
      jobId: job.id
    });
    
    queueJobsTotal.labels('inventory', 'failed').inc();
    throw error;
    
  } finally {
    activeJobs.labels('inventory').dec();
  }
});

// Scheduled tasks

// Daily inventory check at 2 AM
const dailyInventoryCheck = new CronJob('0 2 * * *', async () => {
  try {
    logger.info('Running daily inventory check');
    
    const result = await pool.query(`
      SELECT id, name, stock_quantity, category 
      FROM products 
      WHERE stock_quantity < 10
      ORDER BY stock_quantity ASC
    `);
    
    if (result.rows.length > 0) {
      await emailQueue.add('send-email', {
        to: 'inventory@example.com',
        subject: 'Daily Low Stock Report',
        template: 'daily-inventory-report',
        templateData: { lowStockItems: result.rows }
      });
      
      logger.info(`Found ${result.rows.length} low stock items`);
    }
    
  } catch (error) {
    logger.error('Daily inventory check failed', { error: error.message });
  }
});

// Weekly order summary on Sundays at 9 AM
const weeklyOrderSummary = new CronJob('0 9 * * 0', async () => {
  try {
    logger.info('Running weekly order summary');
    
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_orders,
        COALESCE(SUM(total_amount), 0) as total_revenue,
        DATE(created_at) as order_date
      FROM orders 
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at)
      ORDER BY order_date DESC
    `);
    
    if (result.rows.length > 0) {
      await emailQueue.add('send-email', {
        to: 'reports@example.com',
        subject: 'Weekly Order Summary',
        template: 'weekly-summary',
        templateData: { dailyStats: result.rows }
      });
      
      logger.info(`Generated weekly summary with ${result.rows.length} days of data`);
    }
    
  } catch (error) {
    logger.error('Weekly order summary failed', { error: error.message });
  }
});

// Graceful shutdown handlers
const gracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}, starting graceful shutdown`);
  
  try {
    // Close queues
    await emailQueue.close();
    await orderProcessingQueue.close();
    await inventoryQueue.close();
    
    // Stop cron jobs
    dailyInventoryCheck.stop();
    weeklyOrderSummary.stop();
    
    // Close database connection
    await pool.end();
    
    // Close Redis connection
    await redisConnection.quit();
    
    logger.info('Graceful shutdown completed');
    process.exit(0);
    
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
};

// Health check endpoint
const healthCheck = async () => {
  try {
    // Check Redis
    await redisConnection.ping();
    
    // Check database
    await pool.query('SELECT 1');
    
    // Check queue connections
    const emailWaiting = await emailQueue.getWaiting();
    const orderWaiting = await orderProcessingQueue.getWaiting();
    const inventoryWaiting = await inventoryQueue.getWaiting();
    
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      queues: {
        email: { waiting: emailWaiting.length },
        order: { waiting: orderWaiting.length },
        inventory: { waiting: inventoryWaiting.length }
      },
      uptime: process.uptime()
    };
    
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
};

// Expose metrics endpoint (if running as HTTP server)
const setupMetricsServer = () => {
  if (process.env.ENABLE_METRICS_SERVER === 'true') {
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
    
    const port = process.env.METRICS_PORT || 3002;
    app.listen(port, () => {
      logger.info(`Metrics server running on port ${port}`);
    });
  }
};

// Start worker
const startWorker = async () => {
  try {
    // Test database connection
    await pool.query('SELECT 1');
    logger.info('Database connected');
    
    // Test Redis connection
    await redisConnection.ping();
    logger.info('Redis connected');
    
    // Start cron jobs
    dailyInventoryCheck.start();
    weeklyOrderSummary.start();
    logger.info('Cron jobs started');
    
    // Setup metrics server
    setupMetricsServer();
    
    logger.info('Worker service started successfully');
    
    // Graceful shutdown handlers
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
  } catch (error) {
    logger.error('Failed to start worker service:', error);
    process.exit(1);
  }
};

// Graceful shutdown on unhandled errors
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', { promise, reason });
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

module.exports = {
  emailQueue,
  orderProcessingQueue,
  inventoryQueue,
  healthCheck
};

// Start the worker
if (require.main === module) {
  startWorker();
}