const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || '172.28.0.30',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'enrollment_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

pool.on('connect', () => {
  console.log('✓ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

/**
 * Get user by ID
 */
async function getUserById(userId) {
  const result = await pool.query(
    'SELECT * FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0];
}

/**
 * Get user by email
 */
async function getUserByEmail(email) {
  const result = await pool.query(
    'SELECT * FROM users WHERE email = $1',
    [email]
  );
  return result.rows[0];
}

/**
 * Create new user
 */
async function createUser(userData) {
  const { email, password_hash, first_name, last_name, role } = userData;

  const result = await pool.query(
    `INSERT INTO users (email, password_hash, first_name, last_name, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [email, password_hash, first_name, last_name, role]
  );

  return result.rows[0];
}

/**
 * Update user
 */
async function updateUser(userId, updates) {
  const fields = [];
  const values = [];
  let paramCount = 1;

  if (updates.first_name !== undefined) {
    fields.push(`first_name = $${paramCount++}`);
    values.push(updates.first_name);
  }

  if (updates.last_name !== undefined) {
    fields.push(`last_name = $${paramCount++}`);
    values.push(updates.last_name);
  }

  if (updates.email !== undefined) {
    fields.push(`email = $${paramCount++}`);
    values.push(updates.email);
  }

  if (fields.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(userId);

  const result = await pool.query(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
    values
  );

  return result.rows[0];
}

/**
 * List users with optional filtering
 */
async function listUsers(filters = {}) {
  let query = 'SELECT * FROM users';
  const values = [];
  const conditions = [];
  let paramCount = 1;

  if (filters.role) {
    conditions.push(`role = $${paramCount++}`);
    values.push(filters.role);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY created_at DESC';

  if (filters.limit) {
    query += ` LIMIT $${paramCount++}`;
    values.push(filters.limit);
  }

  if (filters.offset) {
    query += ` OFFSET $${paramCount++}`;
    values.push(filters.offset);
  }

  const result = await pool.query(query, values);

  // Get total count
  let countQuery = 'SELECT COUNT(*) FROM users';
  if (conditions.length > 0) {
    countQuery += ' WHERE ' + conditions.join(' AND ');
  }
  const countResult = await pool.query(countQuery, filters.role ? [filters.role] : []);

  return {
    users: result.rows,
    total: parseInt(countResult.rows[0].count)
  };
}

module.exports = {
  getUserById,
  getUserByEmail,
  createUser,
  updateUser,
  listUsers,
  pool
};
