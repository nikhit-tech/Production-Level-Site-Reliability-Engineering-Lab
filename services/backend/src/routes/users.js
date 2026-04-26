const express = require('express');
const { getPool } = require('../database/connection');
const { validateUserUpdate } = require('../middleware/validation');
const { authenticate } = require('../middleware/authenticate');
const winston = require('winston');

const router = express.Router();

// All user routes require a valid session
router.get('/profile', authenticate, async (req, res) => {
  try {
    const { userId } = req.user;

    const [userResult, orderStats] = await Promise.all([
      getPool().query(
        'SELECT id, email, first_name, last_name, created_at, updated_at FROM users WHERE id = $1',
        [userId]
      ),
      getPool().query(
        `SELECT COUNT(*) as total_orders,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_orders,
                COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_orders,
                COALESCE(SUM(total_amount), 0) as total_spent
         FROM orders WHERE user_id = $1`,
        [userId]
      ),
    ]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ ...userResult.rows[0], order_statistics: orderStats.rows[0] });
  } catch (error) {
    winston.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

router.put('/profile', authenticate, validateUserUpdate, async (req, res) => {
  try {
    const { userId } = req.user;
    const { email, first_name, last_name } = req.body;

    if (email) {
      const existing = await getPool().query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [email, userId]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Email already taken' });
      }
    }

    const fields = [];
    const values = [];
    let idx = 1;

    if (email)      { fields.push(`email = $${idx++}`);      values.push(email); }
    if (first_name) { fields.push(`first_name = $${idx++}`); values.push(first_name); }
    if (last_name)  { fields.push(`last_name = $${idx++}`);  values.push(last_name); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(userId);

    const result = await getPool().query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, email, first_name, last_name, created_at, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    winston.info(`User profile updated: ${userId}`);
    res.json(result.rows[0]);
  } catch (error) {
    winston.error('Error updating user profile:', error);
    res.status(500).json({ error: 'Failed to update user profile' });
  }
});

router.get('/orders', authenticate, async (req, res) => {
  try {
    const { userId } = req.user;
    const { page = 1, limit = 10, status } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT o.*, COUNT(oi.id) as item_count
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.user_id = $1
    `;
    let countQuery = 'SELECT COUNT(*) FROM orders WHERE user_id = $1';
    const params = [userId];

    if (status) {
      query += ` AND o.status = $${params.length + 1}`;
      countQuery += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` GROUP BY o.id ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const [ordersResult, countResult] = await Promise.all([
      getPool().query(query, params),
      getPool().query(countQuery, status ? [userId, status] : [userId]),
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
    winston.error('Error fetching user orders:', error);
    res.status(500).json({ error: 'Failed to fetch user orders' });
  }
});

router.get('/orders/:orderId', authenticate, async (req, res) => {
  try {
    const { userId } = req.user;
    const { orderId } = req.params;

    const [orderResult, itemsResult] = await Promise.all([
      getPool().query('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [orderId, userId]),
      getPool().query(
        'SELECT oi.*, p.name as product_name, p.category FROM order_items oi LEFT JOIN products p ON oi.product_id = p.id WHERE oi.order_id = $1',
        [orderId]
      ),
    ]);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({ ...orderResult.rows[0], items: itemsResult.rows });
  } catch (error) {
    winston.error('Error fetching user order:', error);
    res.status(500).json({ error: 'Failed to fetch user order' });
  }
});

router.get('/stats', authenticate, async (req, res) => {
  try {
    const { userId } = req.user;

    const [overview, monthlySpending, topCategories] = await Promise.all([
      getPool().query(
        `SELECT COUNT(*) as total_orders,
                COALESCE(SUM(total_amount), 0) as total_spent,
                COALESCE(AVG(total_amount), 0) as avg_order_value,
                MIN(created_at) as first_order_date,
                MAX(created_at) as last_order_date
         FROM orders WHERE user_id = $1`,
        [userId]
      ),
      getPool().query(
        `SELECT DATE_TRUNC('month', created_at) as month, COUNT(*) as orders, SUM(total_amount) as spent
         FROM orders
         WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '12 months' AND status != 'cancelled'
         GROUP BY DATE_TRUNC('month', created_at)
         ORDER BY month DESC`,
        [userId]
      ),
      getPool().query(
        `SELECT p.category, COUNT(DISTINCT o.id) as orders, SUM(oi.quantity) as items_purchased, SUM(oi.price * oi.quantity) as total_spent
         FROM orders o
         JOIN order_items oi ON o.id = oi.order_id
         JOIN products p ON oi.product_id = p.id
         WHERE o.user_id = $1 AND o.status != 'cancelled'
         GROUP BY p.category
         ORDER BY total_spent DESC
         LIMIT 5`,
        [userId]
      ),
    ]);

    res.json({
      overview: overview.rows[0],
      monthly_spending: monthlySpending.rows,
      top_categories: topCategories.rows,
    });
  } catch (error) {
    winston.error('Error fetching user statistics:', error);
    res.status(500).json({ error: 'Failed to fetch user statistics' });
  }
});

// Account deletion — dedicated client for transaction integrity
router.delete('/account', authenticate, async (req, res) => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const { userId } = req.user;

    await client.query(
      'DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = $1)',
      [userId]
    );
    await client.query('DELETE FROM orders WHERE user_id = $1', [userId]);

    const result = await client.query('DELETE FROM users WHERE id = $1 RETURNING email', [userId]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    await client.query('COMMIT');

    const { getRedisClient } = require('../redis/connection');
    await getRedisClient().del(`session:${userId}`);

    winston.info(`User account deleted: ${userId} (${result.rows[0].email})`);
    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    winston.error('Error deleting user account:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  } finally {
    client.release();
  }
});

module.exports = router;
