const express = require('express');
const { getPool } = require('../database/connection');
const { getRedisClient } = require('../redis/connection');
const { validateProduct, validateProductId } = require('../middleware/validation');
const { authenticate } = require('../middleware/authenticate');
const { scanAndDelete } = require('../utils/redis-helpers');
const winston = require('winston');

const router = express.Router();
const CACHE_TTL = 300;

// Search MUST be declared before /:id — otherwise Express matches "search" as a UUID param
router.get('/search/:query', async (req, res) => {
  try {
    const { query } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    if (query.length > 200) {
      return res.status(400).json({ error: 'Search query too long' });
    }

    const searchTerm = `%${query}%`;
    const [result, countResult] = await Promise.all([
      getPool().query(
        'SELECT * FROM products WHERE name ILIKE $1 OR description ILIKE $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [searchTerm, limit, offset]
      ),
      getPool().query(
        'SELECT COUNT(*) FROM products WHERE name ILIKE $1 OR description ILIKE $1',
        [searchTerm]
      ),
    ]);

    res.json({
      products: result.rows,
      query,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit),
      },
    });
  } catch (error) {
    winston.error('Error searching products:', error);
    res.status(500).json({ error: 'Failed to search products' });
  }
});

// Get all products
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, category } = req.query;
    const offset = (page - 1) * limit;

    const cacheKey = `products:page:${page}:limit:${limit}:category:${category || 'all'}`;
    const cached = await getRedisClient().get(cacheKey);
    if (cached) {
      winston.info('Products served from cache');
      return res.json(JSON.parse(cached));
    }

    const queryParams = [];
    let query = 'SELECT * FROM products';
    let countQuery = 'SELECT COUNT(*) FROM products';

    if (category) {
      query += ' WHERE category = $1';
      countQuery += ' WHERE category = $1';
      queryParams.push(category);
    }

    query += ` ORDER BY created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    queryParams.push(limit, offset);

    const [productsResult, countResult] = await Promise.all([
      getPool().query(query, queryParams),
      getPool().query(countQuery, category ? [category] : []),
    ]);

    const response = {
      products: productsResult.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit),
      },
    };

    await getRedisClient().setEx(cacheKey, CACHE_TTL, JSON.stringify(response));
    res.json(response);
  } catch (error) {
    winston.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Get product by ID
router.get('/:id', validateProductId, async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `product:${id}`;

    const cached = await getRedisClient().get(cacheKey);
    if (cached) {
      winston.info(`Product ${id} served from cache`);
      return res.json(JSON.parse(cached));
    }

    const result = await getPool().query('SELECT * FROM products WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    await getRedisClient().setEx(cacheKey, CACHE_TTL, JSON.stringify(result.rows[0]));
    res.json(result.rows[0]);
  } catch (error) {
    winston.error('Error fetching product:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// Write operations require authentication
router.post('/', authenticate, validateProduct, async (req, res) => {
  try {
    const { name, description, price, stock_quantity, category } = req.body;

    const result = await getPool().query(
      'INSERT INTO products (name, description, price, stock_quantity, category) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, description, price, stock_quantity, category]
    );

    await scanAndDelete(getRedisClient(), 'products:*');

    winston.info(`New product created: ${result.rows[0].id}`);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    winston.error('Error creating product:', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

router.put('/:id', authenticate, validateProductId, validateProduct, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, stock_quantity, category } = req.body;

    const result = await getPool().query(
      'UPDATE products SET name=$1, description=$2, price=$3, stock_quantity=$4, category=$5, updated_at=CURRENT_TIMESTAMP WHERE id=$6 RETURNING *',
      [name, description, price, stock_quantity, category, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    await getRedisClient().setEx(`product:${id}`, CACHE_TTL, JSON.stringify(result.rows[0]));
    await scanAndDelete(getRedisClient(), 'products:*');

    winston.info(`Product updated: ${id}`);
    res.json(result.rows[0]);
  } catch (error) {
    winston.error('Error updating product:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

router.delete('/:id', authenticate, validateProductId, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await getPool().query('DELETE FROM products WHERE id=$1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    await getRedisClient().del(`product:${id}`);
    await scanAndDelete(getRedisClient(), 'products:*');

    winston.info(`Product deleted: ${id}`);
    res.status(204).send();
  } catch (error) {
    winston.error('Error deleting product:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

module.exports = router;
