const express = require('express');
const { getPool } = require('../database/connection');
const { getRedisClient } = require('../redis/connection');
const { validateProduct, validateProductId } = require('../middleware/validation');
const winston = require('winston');

const router = express.Router();

// Cache TTL in seconds
const CACHE_TTL = 300;

// Get all products
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, category } = req.query;
    const offset = (page - 1) * limit;
    
    // Try to get from cache first
    const redisClient = getRedisClient();
    const cacheKey = `products:page:${page}:limit:${limit}:category:${category || 'all'}`;
    
    const cachedProducts = await redisClient.get(cacheKey);
    if (cachedProducts) {
      winston.info('Products served from cache');
      return res.json(JSON.parse(cachedProducts));
    }

    let query = 'SELECT * FROM products';
    let countQuery = 'SELECT COUNT(*) FROM products';
    const queryParams = [];

    if (category) {
      query += ' WHERE category = $1';
      countQuery += ' WHERE category = $1';
      queryParams.push(category);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (queryParams.length + 1) + ' OFFSET $' + (queryParams.length + 2);
    queryParams.push(limit, offset);

    const [productsResult, countResult] = await Promise.all([
      getPool().query(query, queryParams),
      getPool().query(countQuery, category ? [category] : [])
    ]);

    const response = {
      products: productsResult.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    };

    // Cache the response
    await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(response));
    
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
    
    // Try cache first
    const redisClient = getRedisClient();
    const cacheKey = `product:${id}`;
    
    const cachedProduct = await redisClient.get(cacheKey);
    if (cachedProduct) {
      winston.info(`Product ${id} served from cache`);
      return res.json(JSON.parse(cachedProduct));
    }

    const result = await getPool().query(
      'SELECT * FROM products WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = result.rows[0];
    
    // Cache the product
    await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(product));
    
    res.json(product);
  } catch (error) {
    winston.error('Error fetching product:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// Create new product
router.post('/', validateProduct, async (req, res) => {
  try {
    const { name, description, price, stock_quantity, category } = req.body;
    
    const result = await getPool().query(
      'INSERT INTO products (name, description, price, stock_quantity, category) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, description, price, stock_quantity, category]
    );

    const newProduct = result.rows[0];
    
    // Invalidate relevant cache entries
    const redisClient = getRedisClient();
    const keys = await redisClient.keys('products:*');
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
    
    winston.info(`New product created: ${newProduct.id}`);
    
    res.status(201).json(newProduct);
  } catch (error) {
    winston.error('Error creating product:', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// Update product
router.put('/:id', validateProductId, validateProduct, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, stock_quantity, category } = req.body;
    
    const result = await getPool().query(
      'UPDATE products SET name = $1, description = $2, price = $3, stock_quantity = $4, category = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6 RETURNING *',
      [name, description, price, stock_quantity, category, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const updatedProduct = result.rows[0];
    
    // Update cache
    const redisClient = getRedisClient();
    await redisClient.setEx(`product:${id}`, CACHE_TTL, JSON.stringify(updatedProduct));
    
    // Invalidate product list cache
    const keys = await redisClient.keys('products:*');
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
    
    winston.info(`Product updated: ${id}`);
    
    res.json(updatedProduct);
  } catch (error) {
    winston.error('Error updating product:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// Delete product
router.delete('/:id', validateProductId, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await getPool().query(
      'DELETE FROM products WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Remove from cache
    const redisClient = getRedisClient();
    await redisClient.del(`product:${id}`);
    
    // Invalidate product list cache
    const keys = await redisClient.keys('products:*');
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
    
    winston.info(`Product deleted: ${id}`);
    
    res.status(204).send();
  } catch (error) {
    winston.error('Error deleting product:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// Search products
router.get('/search/:query', async (req, res) => {
  try {
    const { query } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;
    
    const searchQuery = `%${query}%`;
    
    const result = await getPool().query(
      'SELECT * FROM products WHERE name ILIKE $1 OR description ILIKE $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [searchQuery, limit, offset]
    );

    const countResult = await getPool().query(
      'SELECT COUNT(*) FROM products WHERE name ILIKE $1 OR description ILIKE $1',
      [searchQuery]
    );

    const response = {
      products: result.rows,
      query,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    };

    res.json(response);
  } catch (error) {
    winston.error('Error searching products:', error);
    res.status(500).json({ error: 'Failed to search products' });
  }
});

module.exports = router;