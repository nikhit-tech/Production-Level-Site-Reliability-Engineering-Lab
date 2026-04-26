const redis = require('redis');
const winston = require('winston');

let redisClient;

const initRedis = async () => {
  redisClient = redis.createClient({
    socket: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT, 10) || 6379,
      reconnectStrategy: (retries) => {
        if (retries > 10) return new Error('Redis max retries exceeded');
        return Math.min(retries * 200, 3000);
      },
    },
    password: process.env.REDIS_PASSWORD || undefined,
  });

  redisClient.on('error', (err) => winston.error('Redis Client Error:', err));
  redisClient.on('connect', () => winston.info('Redis connected'));
  redisClient.on('ready', () => winston.info('Redis client ready'));
  redisClient.on('end', () => winston.info('Redis connection ended'));

  await redisClient.connect();
  return redisClient;
};

const getRedisClient = () => {
  if (!redisClient) throw new Error('Redis not initialized. Call initRedis() first.');
  return redisClient;
};

module.exports = { initRedis, getRedisClient };
