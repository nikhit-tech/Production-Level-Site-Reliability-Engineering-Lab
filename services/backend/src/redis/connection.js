const redis = require('redis');
const winston = require('winston');

let redisClient;

const initRedis = async () => {
  try {
    redisClient = redis.createClient({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      retry_delay_on_failover: 100,
      max_retries_per_request: 3,
    });

    redisClient.on('error', (err) => {
      winston.error('Redis Client Error:', err);
    });

    redisClient.on('connect', () => {
      winston.info('Redis connected successfully');
    });

    redisClient.on('ready', () => {
      winston.info('Redis client ready');
    });

    redisClient.on('end', () => {
      winston.info('Redis connection ended');
    });

    await redisClient.connect();
    
    return redisClient;
  } catch (error) {
    winston.error('Redis connection failed:', error);
    throw error;
  }
};

const getRedisClient = () => {
  if (!redisClient) {
    throw new Error('Redis not initialized');
  }
  return redisClient;
};

module.exports = {
  initRedis,
  getRedisClient,
  redisClient
};