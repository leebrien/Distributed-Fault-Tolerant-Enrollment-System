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
 * Get course by ID
 */
async function getCourseById(courseId) {
  const result = await pool.query(
    'SELECT * FROM courses WHERE id = $1',
    [courseId]
  );
  return result.rows[0];
}

/**
 * Get course by code
 */
async function getCourseByCode(code) {
  const result = await pool.query(
    'SELECT * FROM courses WHERE code = $1',
    [code]
  );
  return result.rows[0];
}

/**
 * List all courses
 */
async function listCourses(filters = {}) {
  let query = 'SELECT * FROM courses ORDER BY code';
  const values = [];

  if (filters.limit) {
    query += ` LIMIT $1`;
    values.push(filters.limit);
  }

  if (filters.offset) {
    query += ` OFFSET $${values.length + 1}`;
    values.push(filters.offset);
  }

  const result = await pool.query(query, values);

  // Get total count
  const countResult = await pool.query('SELECT COUNT(*) FROM courses');

  return {
    courses: result.rows,
    total: parseInt(countResult.rows[0].count)
  };
}

/**
 * Get section by ID
 */
async function getSectionById(sectionId) {
  const result = await pool.query(
    `SELECT s.*, c.code as course_code, c.name as course_name, c.units, c.description
     FROM sections s
     JOIN courses c ON s.course_id = c.id
     WHERE s.id = $1`,
    [sectionId]
  );
  return result.rows[0];
}

/**
 * List sections with optional filtering
 */
async function listSections(filters = {}) {
  let query = `
    SELECT s.*, c.code as course_code, c.name as course_name, c.units, c.description
    FROM sections s
    JOIN courses c ON s.course_id = c.id
  `;

  const conditions = [];
  const values = [];
  let paramCount = 1;

  if (filters.course_id) {
    conditions.push(`s.course_id = $${paramCount++}`);
    values.push(filters.course_id);
  }

  if (filters.is_open !== undefined) {
    conditions.push(`s.is_open = $${paramCount++}`);
    values.push(filters.is_open);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY c.code, s.section_code';

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
  let countQuery = 'SELECT COUNT(*) FROM sections s';
  const countConditions = [];
  const countValues = [];
  let countParamCount = 1;

  if (filters.course_id) {
    countConditions.push(`s.course_id = $${countParamCount++}`);
    countValues.push(filters.course_id);
  }

  if (filters.is_open !== undefined) {
    countConditions.push(`s.is_open = $${countParamCount++}`);
    countValues.push(filters.is_open);
  }

  if (countConditions.length > 0) {
    countQuery += ' WHERE ' + countConditions.join(' AND ');
  }

  const countResult = await pool.query(countQuery, countValues);

  return {
    sections: result.rows,
    total: parseInt(countResult.rows[0].count)
  };
}

/**
 * Check section availability
 */
async function checkSectionAvailability(sectionId) {
  const section = await getSectionById(sectionId);

  if (!section) {
    return {
      is_available: false,
      remaining_slots: 0,
      message: 'Section not found'
    };
  }

  if (!section.is_open) {
    return {
      is_available: false,
      remaining_slots: 0,
      message: 'Section is closed'
    };
  }

  const remaining = section.capacity - section.enrolled_count;

  return {
    is_available: remaining > 0,
    remaining_slots: remaining,
    message: remaining > 0 ? 'Section available' : 'Section is full'
  };
}

/**
 * Update enrollment count (used by enrollment service via gRPC)
 */
async function updateEnrollmentCount(sectionId, increment) {
  const result = await pool.query(
    `UPDATE sections
     SET enrolled_count = enrolled_count + $1
     WHERE id = $2
     RETURNING *`,
    [increment, sectionId]
  );

  if (result.rows.length === 0) {
    throw new Error('Section not found');
  }

  return result.rows[0];
}

module.exports = {
  getCourseById,
  getCourseByCode,
  listCourses,
  getSectionById,
  listSections,
  checkSectionAvailability,
  updateEnrollmentCount,
  pool
};
