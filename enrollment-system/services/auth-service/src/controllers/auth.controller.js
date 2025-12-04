const bcrypt = require('bcrypt');
const { userServiceClient } = require('../grpc/client');
const { generateToken } = require('../utils/jwt.utils');
const { blacklistToken, storeSession, deleteSession } = require('../utils/redis.client');

/**
 * Login user
 */
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Call User Service via gRPC to get user by email
    userServiceClient.GetUserByEmail({ email }, async (error, user) => {
      if (error) {
        console.error('gRPC error:', error);
        return res.status(500).json({ error: 'Failed to authenticate user' });
      }

      if (!user || !user.id) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Generate JWT token
      const token = generateToken(user);

      // Store session in Redis
      await storeSession(user.id, {
        email: user.email,
        role: user.role,
        loginTime: new Date().toISOString()
      });

      // Return user data and token (excluding password)
      res.json({
        success: true,
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role
        }
      });
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Logout user
 */
async function logout(req, res) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(400).json({ error: 'No token provided' });
    }

    // Blacklist the token
    await blacklistToken(token);

    // Delete session from Redis
    if (req.user && req.user.id) {
      await deleteSession(req.user.id);
    }

    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Verify token
 */
async function verifyTokenEndpoint(req, res) {
  try {
    // If middleware passed, token is valid
    res.json({
      success: true,
      user: req.user
    });
  } catch (error) {
    console.error('Verify token error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get current user (protected route example)
 */
async function getCurrentUser(req, res) {
  try {
    const userId = req.user.id;

    userServiceClient.GetUser({ user_id: userId }, (error, user) => {
      if (error) {
        console.error('gRPC error:', error);
        return res.status(500).json({ error: 'Failed to fetch user' });
      }

      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
          createdAt: user.created_at
        }
      });
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  login,
  logout,
  verifyTokenEndpoint,
  getCurrentUser
};
