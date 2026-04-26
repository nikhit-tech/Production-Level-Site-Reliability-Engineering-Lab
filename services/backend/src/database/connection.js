const { Pool } = require('pg');
const winston = require('winston');

let pool;

// Retries with linear back-off so slow-starting Postgres in Kubernetes
// doesn't immediately crash-loop the backend pod.
const connectWithRetry = async (config, maxRetries = 10, baseDelayMs = 2000) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const candidate = new Pool(config);
      const client = await candidate.connect();
      await client.query('SELECT NOW()');
      client.release();
      return candidate;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = baseDelayMs * attempt;
      winston.warn(`DB connection attempt ${attempt}/${maxRetries} failed — retrying in ${delay}ms: ${err.message}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
};

const initDatabase = async () => {
  if (!process.env.DB_PASSWORD) {
    throw new Error('DB_PASSWORD environment variable is required');
  }

  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || 'ecommerce',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
  };

  pool = await connectWithRetry(config);
  winston.info('Database connected successfully');

  await createTables();
  await createIndexes();

  return pool;
};

const createTables = async () => {
  const queries = [
    `CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS products (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      price DECIMAL(10,2) NOT NULL,
      stock_quantity INTEGER DEFAULT 0,
      category VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id),
      total_amount DECIMAL(10,2) NOT NULL,
      status VARCHAR(50) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS order_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID REFERENCES orders(id),
      product_id UUID REFERENCES products(id),
      quantity INTEGER NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
  ];

  for (const query of queries) {
    await pool.query(query);
  }
  winston.info('Database tables created/verified');
};

const createIndexes = async () => {
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
    'CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)',
    'CREATE INDEX IF NOT EXISTS idx_products_stock ON products(stock_quantity)',
    'CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)',
    'CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)',
    'CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id)',
  ];

  for (const idx of indexes) {
    await pool.query(idx);
  }
  winston.info('Database indexes created/verified');
};

const getPool = () => {
  if (!pool) throw new Error('Database not initialized. Call initDatabase() first.');
  return pool;
};

module.exports = { initDatabase, getPool };
