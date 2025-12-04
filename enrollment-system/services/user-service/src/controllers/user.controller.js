const userModel = require('../models/user.model');
const bcrypt = require('bcrypt');

/**
 * Get user by ID
 */
async function getUser(req, res) {
  try {
    const userId = parseInt(req.params.id);
    const user = await userModel.getUserById(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Don't send password hash
    const { password_hash, ...userData } = user;

    res.json({
      success: true,
      user: userData
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Update user
 */
async function updateUser(req, res) {
  try {
    const userId = parseInt(req.params.id);
    const { first_name, last_name, email } = req.body;

    // Check authorization (users can only update their own profile, or admin)
    if (req.user.id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to update this user' });
    }

    const updates = {};
    if (first_name) updates.first_name = first_name;
    if (last_name) updates.last_name = last_name;
    if (email) updates.email = email;

    const user = await userModel.updateUser(userId, updates);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { password_hash, ...userData } = user;

    res.json({
      success: true,
      user: userData
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * List users (admin only)
 */
async function listUsers(req, res) {
  try {
    const { role, limit = 50, offset = 0 } = req.query;

    const filters = {
      role,
      limit: parseInt(limit),
      offset: parseInt(offset)
    };

    const { users, total } = await userModel.listUsers(filters);

    // Remove password hashes
    const sanitizedUsers = users.map(({ password_hash, ...user }) => user);

    res.json({
      success: true,
      users: sanitizedUsers,
      total,
      limit: filters.limit,
      offset: filters.offset
    });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Create user (admin only or registration)
 */
async function createUser(req, res) {
  try {
    const { email, password, first_name, last_name, role } = req.body;

    if (!email || !password || !first_name || !last_name || !role) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if user exists
    const existingUser = await userModel.getUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    const user = await userModel.createUser({
      email,
      password_hash,
      first_name,
      last_name,
      role
    });

    const { password_hash: _, ...userData } = user;

    res.status(201).json({
      success: true,
      user: userData
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getUser,
  updateUser,
  listUsers,
  createUser
};
