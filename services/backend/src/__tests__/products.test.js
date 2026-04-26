const request = require('supertest');

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'testpassword';
process.env.NODE_ENV = 'test';

const mockProducts = [
  { id: '123e4567-e89b-12d3-a456-426614174000', name: 'Test Product', price: 9.99, stock_quantity: 100, category: 'electronics' },
];

jest.mock('../database/connection', () => ({
  initDatabase: jest.fn().mockResolvedValue({}),
  getPool: jest.fn().mockReturnValue({
    query: jest.fn().mockImplementation((sql) => {
      if (sql.includes('SELECT * FROM products')) return Promise.resolve({ rows: mockProducts });
      if (sql.includes('SELECT COUNT(*)')) return Promise.resolve({ rows: [{ count: '1' }] });
      if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX')) return Promise.resolve({ rows: [] });
      if (sql.includes('SELECT NOW()') || sql.includes('SELECT 1')) return Promise.resolve({ rows: [{}] });
      return Promise.resolve({ rows: [] });
    }),
    end: jest.fn().mockResolvedValue({}),
  }),
}));

jest.mock('../redis/connection', () => ({
  initRedis: jest.fn().mockResolvedValue({}),
  getRedisClient: jest.fn().mockReturnValue({
    ping: jest.fn().mockResolvedValue('PONG'),
    get: jest.fn().mockResolvedValue(null),
    setEx: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    scan: jest.fn().mockResolvedValue({ cursor: 0, keys: [] }),
    info: jest.fn().mockResolvedValue(''),
    quit: jest.fn().mockResolvedValue('OK'),
  }),
}));

const app = require('../index');

describe('Products API', () => {
  it('GET /api/products returns paginated product list', async () => {
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('products');
    expect(res.body).toHaveProperty('pagination');
    expect(Array.isArray(res.body.products)).toBe(true);
  });

  it('GET /api/products supports category filter', async () => {
    const res = await request(app).get('/api/products?category=electronics');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('products');
  });

  it('POST /api/products without auth returns 401', async () => {
    const res = await request(app)
      .post('/api/products')
      .send({ name: 'New Product', price: 19.99, stock_quantity: 10 });
    expect(res.status).toBe(401);
  });

  it('GET /api/products/search/:query is reachable (not shadowed by /:id)', async () => {
    const res = await request(app).get('/api/products/search/laptop');
    // Should reach the search handler (not 400 UUID validation error)
    expect(res.status).not.toBe(400);
  });

  it('GET /api/products/:id with invalid UUID returns 400', async () => {
    const res = await request(app).get('/api/products/not-a-uuid');
    expect(res.status).toBe(400);
  });
});
