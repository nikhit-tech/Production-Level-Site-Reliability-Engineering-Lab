const express = require('express');
const { getPool } = require('../database/connection');
const { getRedisClient } = require('../redis/connection');
const { validateOrder, validateOrderId } = require('../middleware/validation');
const { authenticate } = require('../middleware/authenticate');
const { scanAndDelete } = require('../utils/redis-helpers');
const winston = require('winston');

const router = express.Router();

// Stats MUST be before /:id — "stats" would otherwise be treated as an order UUID
router.get('/stats/summary', authenticate, async (req, res) => {
  try {
    const [stats, dailyStats] = await Promise.all([
      getPool().query(`
        SELECT
          COUNT(*) as total_orders,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_orders,
          COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_orders,
          COUNT(CASE WHEN status = 'shipped' THEN 1 END) as shipped_orders,
          COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_orders,
          COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_orders,
          COALESCE(SUM(total_amount), 0) as total_revenue,
          COALESCE(AVG(total_amount), 0) as avg_order_value
        FROM orders
        WHERE created_at >= NOW() - INTERVAL '30 days'
      `),
      getPool().query(`
        SELECT DATE(created_at) as date, COUNT(*) as orders, SUM(total_amount) as revenue
        FROM orders
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY DATE(created_at)
        ORDER BY date
      `),
    ]);

    res.json({ summary: stats.rows[0], daily: dailyStats.rows });
  } catch (error) {
    winston.error('Error fetching order statistics:', error);
    res.status(500).json({ error: 'Failed to fetch order statistics' });
  }
});

// Get all orders
router.get('/', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 10, status, user_id } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT o.*, u.email, u.first_name, u.last_name, COUNT(oi.id) as item_count
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
    `;
    let countQuery = 'SELECT COUNT(*) FROM orders o';
    const queryParams = [];
    const conditions = [];

    if (status) {
      conditions.push(`o.status = $${queryParams.length + 1}`);
      queryParams.push(status);
    }
    if (user_id) {
      conditions.push(`o.user_id = $${queryParams.length + 1}`);
      queryParams.push(user_id);
    }
    if (conditions.length > 0) {
      const where = ' WHERE ' + conditions.join(' AND ');
      query += where;
      countQuery += where;
    }

    query += ' GROUP BY o.id, u.email, u.first_name, u.last_name ORDER BY o.created_at DESC';
    query += ` LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    queryParams.push(limit, offset);

    const [ordersResult, countResult] = await Promise.all([
      getPool().query(query, queryParams),
      getPool().query(countQuery, queryParams.slice(0, -2)),
    ]);

    res.json({
      orders: ordersResult.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit),
      },
    });
  } catch (error) {
    winston.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Get order by ID
router.get('/:id', authenticate, validateOrderId, async (req, res) => {
  try {
    const { id } = req.params;

    const [orderResult, itemsResult] = await Promise.all([
      getPool().query(
        'SELECT o.*, u.email, u.first_name, u.last_name FROM orders o LEFT JOIN users u ON o.user_id = u.id WHERE o.id = $1',
        [id]
      ),
      getPool().query(
        'SELECT oi.*, p.name as product_name, p.category FROM order_items oi LEFT JOIN products p ON oi.product_id = p.id WHERE oi.order_id = $1',
        [id]
      ),
    ]);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({ ...orderResult.rows[0], items: itemsResult.rows });
  } catch (error) {
    winston.error('Error fetching order:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// Create order — uses a dedicated pool client so BEGIN/COMMIT are on a single connection
router.post('/', authenticate, validateOrder, async (req, res) => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const { user_id, items } = req.body;
    let totalAmount = 0;
    const validatedItems = [];

    for (const item of items) {
      const productResult = await client.query(
        'SELECT id, name, price, stock_quantity FROM products WHERE id = $1 FOR UPDATE',
        [item.product_id]
      );
      if (productResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Product ${item.product_id} not found` });
      }

      const product = productResult.rows[0];
      if (product.stock_quantity < item.quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Insufficient stock for ${product.name}. Available: ${product.stock_quantity}, Requested: ${item.quantity}`,
        });
      }

      totalAmount += product.price * item.quantity;
      validatedItems.push({ ...item, price: product.price, product_name: product.name });
    }

    const orderResult = await client.query(
      'INSERT INTO orders (user_id, total_amount, status) VALUES ($1, $2, $3) RETURNING *',
      [user_id, totalAmount, 'pending']
    );
    const newOrder = orderResult.rows[0];

    for (const item of validatedItems) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)',
        [newOrder.id, item.product_id, item.quantity, item.price]
      );
      await client.query(
        'UPDATE products SET stock_quantity = stock_quantity - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [item.quantity, item.product_id]
      );
    }

    await client.query('COMMIT');

    await scanAndDelete(getRedisClient(), 'product:*');
    await scanAndDelete(getRedisClient(), 'products:*');

    winston.info(`New order created: ${newOrder.id} for user: ${user_id}`);
    res.status(201).json({ ...newOrder, items: validatedItems });
  } catch (error) {
    await client.query('ROLLBACK');
    winston.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  } finally {
    client.release();
  }
});

// Update order status
router.patch('/:id/status', authenticate, validateOrderId, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status', valid_statuses: validStatuses });
    }

    const result = await getPool().query(
      'UPDATE orders SET status=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING *',
      [status, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    winston.info(`Order ${id} status updated to: ${status}`);
    res.json(result.rows[0]);
  } catch (error) {
    winston.error('Error updating order status:', error);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

// Cancel order and restore stock — dedicated client for transaction integrity
router.post('/:id/cancel', authenticate, validateOrderId, async (req, res) => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const orderResult = await client.query(
      `SELECT o.*, oi.product_id, oi.quantity
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
       WHERE o.id = $1 AND o.status = 'pending'`,
      [id]
    );

    if (orderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found or cannot be cancelled' });
    }

    await client.query(
      'UPDATE orders SET status=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2',
      ['cancelled', id]
    );

    for (const row of orderResult.rows) {
      if (row.product_id) {
        await client.query(
          'UPDATE products SET stock_quantity = stock_quantity + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [row.quantity, row.product_id]
        );
      }
    }

    await client.query('COMMIT');

    await scanAndDelete(getRedisClient(), 'product:*');
    await scanAndDelete(getRedisClient(), 'products:*');

    winston.info(`Order ${id} cancelled and stock restored`);
    res.json({ message: 'Order cancelled successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    winston.error('Error cancelling order:', error);
    res.status(500).json({ error: 'Failed to cancel order' });
  } finally {
    client.release();
  }
});

module.exports = router;
