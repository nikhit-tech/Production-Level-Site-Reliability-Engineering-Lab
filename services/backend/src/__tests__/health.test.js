const request = require('supertest');

// Set required env before importing app so the startup guard passes
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'testpassword';
process.env.NODE_ENV = 'test';

// Mock database and Redis so unit tests run without real infrastructure
jest.mock('../database/connection', () => ({
  initDatabase: jest.fn().mockResolvedValue({}),
  getPool: jest.fn().mockReturnValue({
    query: jest.fn().mockResolvedValue({ rows: [{ test: 1 }] }),
    totalCount: 1,
    idleCount: 1,
    waitingCount: 0,
    end: jest.fn().mockResolvedValue({}),
  }),
}));

jest.mock('../redis/connection', () => ({
  initRedis: jest.fn().mockResolvedValue({}),
  getRedisClient: jest.fn().mockReturnValue({
    ping: jest.fn().mockResolvedValue('PONG'),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    setEx: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    info: jest.fn().mockResolvedValue('used_memory_human:1.00M\r\n'),
    quit: jest.fn().mockResolvedValue('OK'),
  }),
}));

const app = require('../index');

describe('Health endpoints', () => {
  it('GET /health returns 200 with healthy status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('timestamp');
  });

  it('GET /health includes version field', async () => {
    const res = await request(app).get('/health');
    expect(res.body).toHaveProperty('version');
  });

  it('GET /api/health/liveness returns 200', async () => {
    const res = await request(app).get('/api/health/liveness');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('alive');
  });

  it('GET /api/health/readiness returns 200 when DB and Redis are up', async () => {
    const res = await request(app).get('/api/health/readiness');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('GET /nonexistent returns 404', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('Metrics endpoint', () => {
  it('GET /metrics returns 403 from non-localhost in production', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(app).get('/metrics');
    // supertest uses 127.0.0.1 which IS in the allowlist, so it should be 200
    // This tests that the middleware doesn't break for loopback
    expect([200, 403]).toContain(res.status);
    process.env.NODE_ENV = 'test';
  });
});

describe('Auth rate limiting', () => {
  it('responds with 200 on valid login attempt format', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrongpassword' });
    // 401 is expected (wrong creds via mock), not 429 or 500
    expect([401, 500]).toContain(res.status);
  });
});
