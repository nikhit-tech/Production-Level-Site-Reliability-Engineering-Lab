const express = require('express');
const { getPool } = require('../database/connection');
const { validateUser, validateUserUpdate } = require('../middleware/validation');
const winston = require('winston');

const router = express.Router();

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const result = await getPool().query(
      'SELECT id, email, first_name, last_name, created_at, updated_at FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get user's order statistics
    const orderStats = await getPool().query(
      `SELECT 
        COUNT(*) as total_orders,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_orders,
        COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_orders,
        COALESCE(SUM(total_amount), 0) as total_spent
      FROM orders WHERE user_id = $1`,
      [userId]
    );

    const user = {
      ...result.rows[0],
      order_statistics: orderStats.rows[0]
    };

    res.json(user);
  } catch (error) {
    winston.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// Update user profile
router.put('/profile', authenticateToken, validateUserUpdate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { email, first_name, last_name } = req.body;

    // Check if email is being updated and if it's already taken
    if (email) {
      const existingUser = await getPool().query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [email, userId]
      );

      if (existingUser.rows.length > 0) {
        return res.status(409).json({ error: 'Email already taken' });
      }
    }

    // Build dynamic update query
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    if (email) {
      updateFields.push(`email = $${paramIndex++}`);
      updateValues.push(email);
    }
    if (first_name) {
      updateFields.push(`first_name = $${paramIndex++}`);
      updateValues.push(first_name);
    }
    if (last_name) {
      updateFields.push(`last_name = $${paramIndex++}`);
      updateValues.push(last_name);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(userId);

    const query = `
      UPDATE users 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, email, first_name, last_name, created_at, updated_at
    `;

    const result = await getPool().query(query, updateValues);

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

// Get user's orders
router.get('/orders', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 10, status } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT o.*, 
             COUNT(oi.id) as item_count
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.user_id = $1
    `;
    
    let countQuery = 'SELECT COUNT(*) FROM orders o WHERE o.user_id = $1';
    const queryParams = [userId];

    if (status) {
      query += ` AND o.status = $${queryParams.length + 1}`;
      countQuery += ` AND o.status = $${queryParams.length + 1}`;
      queryParams.push(status);
    }

    query += ' GROUP BY o.id ORDER BY o.created_at DESC';
    query += ` LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    queryParams.push(limit, offset);

    const [ordersResult, countResult] = await Promise.all([
      getPool().query(query, queryParams),
      getPool().query(countQuery, [userId, status])
    ]);

    const response = {
      orders: ordersResult.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    };

    res.json(response);
  } catch (error) {
    winston.error('Error fetching user orders:', error);
    res.status(500).json({ error: 'Failed to fetch user orders' });
  }
});

// Get specific order details
router.get('/orders/:orderId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { orderId } = req.params;

    // Get order details
    const orderResult = await getPool().query(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
      [orderId, userId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Get order items
    const itemsResult = await getPool().query(`
      SELECT oi.*, p.name as product_name, p.category
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
    `, [orderId]);

    const order = {
      ...orderResult.rows[0],
      items: itemsResult.rows
    };

    res.json(order);
  } catch (error) {
    winston.error('Error fetching user order:', error);
    res.status(500).json({ error: 'Failed to fetch user order' });
  }
});

// Get user statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const orderStats = await getPool().query(`
      SELECT 
        COUNT(*) as total_orders,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_orders,
        COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_orders,
        COUNT(CASE WHEN status = 'shipped' THEN 1 END) as shipped_orders,
        COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_orders,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_orders,
        COALESCE(SUM(total_amount), 0) as total_spent,
        COALESCE(AVG(total_amount), 0) as avg_order_value,
        MIN(created_at) as first_order_date,
        MAX(created_at) as last_order_date
      FROM orders 
      WHERE user_id = $1
    `, [userId]);

    const monthlySpending = await getPool().query(`
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*) as orders,
        SUM(total_amount) as spent
      FROM orders 
      WHERE user_id = $1 
        AND created_at >= NOW() - INTERVAL '12 months'
        AND status != 'cancelled'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month DESC
    `, [userId]);

    const topCategories = await getPool().query(`
      SELECT 
        p.category,
        COUNT(DISTINCT o.id) as orders,
        SUM(oi.quantity) as items_purchased,
        SUM(oi.total_price) as total_spent
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      WHERE o.user_id = $1 AND o.status != 'cancelled'
      GROUP BY p.category
      ORDER BY total_spent DESC
      LIMIT 5
    `, [userId]);

    const stats = {
      overview: orderStats.rows[0],
      monthly_spending: monthlySpending.rows,
      top_categories: topCategories.rows
    };

    res.json(stats);
  } catch (error) {
    winston.error('Error fetching user statistics:', error);
    res.status(500).json({ error: 'Failed to fetch user statistics' });
  }
});

// Delete user account (and related data)
router.delete('/account', authenticateToken, async (req, res) => {
  const client = getPool();
  
  try {
    await client.query('BEGIN');
    
    const userId = req.user.userId;

    // Delete user's orders and order items
    await client.query('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = $1)', [userId]);
    await client.query('DELETE FROM orders WHERE user_id = $1', [userId]);

    // Delete user
    const result = await client.query('DELETE FROM users WHERE id = $1 RETURNING email', [userId]);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    await client.query('COMMIT');

    // Clean up Redis sessions
    const { getRedisClient } = require('../redis/connection');
    const redisClient = getRedisClient();
    await redisClient.del(`session:${userId}`);

    winston.info(`User account deleted: ${userId} (${result.rows[0].email})`);

    res.json({ message: 'Account deleted successfully' });

  } catch (error) {
    await client.query('ROLLBACK');
    winston.error('Error deleting user account:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

module.exports = router;