const express = require('express');
const { getPool } = require('../database/connection');
const { getRedisClient } = require('../redis/connection');
const promClient = require('prom-client');
const winston = require('winston');

const router = express.Router();

// Health check metrics
const healthCheckGauge = new promClient.Gauge({
  name: 'health_check_status',
  help: 'Health check status (1 = healthy, 0 = unhealthy)',
  labelNames: ['service']
});

const databaseResponseTime = new promClient.Histogram({
  name: 'database_response_time_seconds',
  help: 'Database query response time',
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5]
});

const redisResponseTime = new promClient.Histogram({
  name: 'redis_response_time_seconds',
  help: 'Redis operation response time',
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1]
});

// Comprehensive health check
router.get('/detailed', async (req, res) => {
  const startTime = Date.now();
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    services: {}
  };

  try {
    // Database health check
    const dbStartTime = Date.now();
    const dbResult = await getPool().query('SELECT 1 as test');
    const dbDuration = (Date.now() - dbStartTime) / 1000;
    
    databaseResponseTime.observe(dbDuration);
    health.services.database = {
      status: 'healthy',
      responseTime: dbDuration,
      connections: getPool().totalCount
    };
    healthCheckGauge.labels('database').set(1);

  } catch (error) {
    health.services.database = {
      status: 'unhealthy',
      error: error.message
    };
    healthCheckGauge.labels('database').set(0);
    health.status = 'degraded';
    winston.error('Database health check failed:', error);
  }

  try {
    // Redis health check
    const redisStartTime = Date.now();
    const redisClient = getRedisClient();
    await redisClient.ping();
    const redisDuration = (Date.now() - redisStartTime) / 1000;
    
    redisResponseTime.observe(redisDuration);
    health.services.redis = {
      status: 'healthy',
      responseTime: redisDuration
    };
    healthCheckGauge.labels('redis').set(1);

  } catch (error) {
    health.services.redis = {
      status: 'unhealthy',
      error: error.message
    };
    healthCheckGauge.labels('redis').set(0);
    health.status = 'degraded';
    winston.error('Redis health check failed:', error);
  }

  // Memory and CPU info
  health.system = {
    memory: process.memoryUsage(),
    cpuUsage: process.cpuUsage(),
    uptime: process.uptime()
  };

  // Overall response time
  health.responseTime = Date.now() - startTime;

  // Determine HTTP status based on overall health
  const statusCode = health.status === 'healthy' ? 200 : 503;
  
  res.status(statusCode).json(health);
});

// Liveness probe (Kubernetes)
router.get('/liveness', (req, res) => {
  // Simple check - if the process is running, we're live
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Readiness probe (Kubernetes)
router.get('/readiness', async (req, res) => {
  // Check if the service is ready to accept traffic
  try {
    // Check database connectivity
    await getPool().query('SELECT 1');
    
    // Check Redis connectivity
    const redisClient = getRedisClient();
    await redisClient.ping();
    
    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'not ready',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Application metrics
router.get('/metrics', async (req, res) => {
  try {
    const pool = getPool();
    const redisClient = getRedisClient();
    
    // Database metrics
    const dbStats = await pool.query(`
      SELECT 
        count(*) as active_connections,
        state,
        count(*) as count
      FROM pg_stat_activity 
      WHERE datname = current_database()
      GROUP BY state
    `);

    // Redis metrics
    const redisInfo = await redisClient.info('memory');
    const redisMemory = {};
    redisInfo.split('\r\n').forEach(line => {
      if (line.includes('used_memory_human:')) {
        redisMemory.used_memory = line.split(':')[1];
      }
    });

    res.json({
      database: {
        active_connections: dbStats.rows,
        pool_stats: {
          total_count: pool.totalCount,
          idle_count: pool.idleCount,
          waiting_count: pool.waitingCount
        }
      },
      redis: {
        memory: redisMemory
      },
      application: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage()
      }
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to collect metrics',
      message: error.message
    });
  }
});

module.exports = router;