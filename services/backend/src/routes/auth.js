const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getPool } = require('../database/connection');
const { getRedisClient } = require('../redis/connection');
const { validateLogin, validateRegister } = require('../middleware/validation');
const winston = require('winston');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// User registration
router.post('/register', validateRegister, async (req, res) => {
  try {
    const { email, password, first_name, last_name } = req.body;

    // Check if user already exists
    const existingUser = await getPool().query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user
    const result = await getPool().query(
      'INSERT INTO users (email, password_hash, first_name, last_name) VALUES ($1, $2, $3, $4) RETURNING id, email, first_name, last_name, created_at',
      [email, passwordHash, first_name, last_name]
    );

    const user = result.rows[0];

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email 
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Store token in Redis for session management
    const redisClient = getRedisClient();
    await redisClient.setEx(`session:${user.id}`, 86400, token); // 24 hours

    winston.info(`New user registered: ${email}`);

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        created_at: user.created_at
      },
      token
    });

  } catch (error) {
    winston.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// User login
router.post('/login', validateLogin, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const result = await getPool().query(
      'SELECT id, email, password_hash, first_name, last_name, created_at FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email 
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Store token in Redis
    const redisClient = getRedisClient();
    await redisClient.setEx(`session:${user.id}`, 86400, token); // 24 hours

    winston.info(`User logged in: ${email}`);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        created_at: user.created_at
      },
      token
    });

  } catch (error) {
    winston.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// User logout
router.post('/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const redisClient = getRedisClient();
        await redisClient.del(`session:${decoded.userId}`);
      } catch (error) {
        // Token is invalid, but we still want to logout
        winston.warn('Invalid token during logout:', error.message);
      }
    }

    res.json({ message: 'Logged out successfully' });

  } catch (error) {
    winston.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Token verification endpoint
router.get('/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check if token is still valid in Redis
    const redisClient = getRedisClient();
    const sessionToken = await redisClient.get(`session:${decoded.userId}`);
    
    if (sessionToken !== token) {
      return res.status(401).json({ error: 'Token invalid or expired' });
    }

    // Get user details
    const result = await getPool().query(
      'SELECT id, email, first_name, last_name, created_at FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    res.json({
      user: result.rows[0],
      token
    });

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }

    winston.error('Token verification error:', error);
    res.status(500).json({ error: 'Token verification failed' });
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(401).json({ error: 'No refresh token provided' });
    }

    const decoded = jwt.verify(refreshToken, JWT_SECRET);
    
    // Check if session is still active
    const redisClient = getRedisClient();
    const sessionToken = await redisClient.get(`session:${decoded.userId}`);
    
    if (!sessionToken) {
      return res.status(401).json({ error: 'Session expired' });
    }

    // Get user details
    const result = await getPool().query(
      'SELECT id, email, first_name, last_name, created_at FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Generate new token
    const newToken = jwt.sign(
      { 
        userId: result.rows[0].id, 
        email: result.rows[0].email 
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Update session
    await redisClient.setEx(`session:${decoded.userId}`, 86400, newToken);

    res.json({
      user: result.rows[0],
      token: newToken
    });

  } catch (error) {
    winston.error('Token refresh error:', error);
    res.status(401).json({ error: 'Token refresh failed' });
  }
});

// Change password
router.post('/change-password', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const { currentPassword, newPassword } = req.body;

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    // Validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check if session is still active
    const redisClient = getRedisClient();
    const sessionToken = await redisClient.get(`session:${decoded.userId}`);
    
    if (sessionToken !== token) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    // Get user with password hash
    const result = await getPool().query(
      'SELECT id, password_hash FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const saltRounds = 12;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await getPool().query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newPasswordHash, user.id]
    );

    // Invalidate all sessions (force re-login)
    await redisClient.del(`session:${user.id}`);

    winston.info(`Password changed for user: ${user.id}`);

    res.json({ message: 'Password changed successfully. Please login again.' });

  } catch (error) {
    winston.error('Password change error:', error);
    res.status(500).json({ error: 'Password change failed' });
  }
});

module.exports = router;