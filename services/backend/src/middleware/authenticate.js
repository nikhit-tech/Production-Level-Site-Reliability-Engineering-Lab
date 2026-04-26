const jwt = require('jsonwebtoken');
const { getRedisClient } = require('../redis/connection');

const JWT_SECRET = process.env.JWT_SECRET;

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Cross-check with Redis session — logout invalidates this even before JWT expiry
    const session = await getRedisClient().get(`session:${decoded.userId}`);
    if (session !== token) {
      return res.status(401).json({ error: 'Session invalid or expired. Please login again.' });
    }

    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = { authenticate };
