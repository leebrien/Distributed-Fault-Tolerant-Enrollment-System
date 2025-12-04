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
 * Create enrollment
 */
async function createEnrollment(studentId, sectionId) {
  const result = await pool.query(
    `INSERT INTO enrollments (student_id, section_id, status)
     VALUES ($1, $2, 'enrolled')
     RETURNING *`,
    [studentId, sectionId]
  );
  return result.rows[0];
}

/**
 * Get enrollment by ID
 */
async function getEnrollmentById(enrollmentId) {
  const result = await pool.query(
    'SELECT * FROM enrollments WHERE id = $1',
    [enrollmentId]
  );
  return result.rows[0];
}

/**
 * Check if student is already enrolled in section
 */
async function isStudentEnrolled(studentId, sectionId) {
  const result = await pool.query(
    'SELECT * FROM enrollments WHERE student_id = $1 AND section_id = $2',
    [studentId, sectionId]
  );
  return result.rows.length > 0;
}

/**
 * List enrollments with filtering
 */
async function listEnrollments(filters = {}) {
  let query = 'SELECT * FROM enrollments';
  const conditions = [];
  const values = [];
  let paramCount = 1;

  if (filters.student_id) {
    conditions.push(`student_id = $${paramCount++}`);
    values.push(filters.student_id);
  }

  if (filters.section_id) {
    conditions.push(`section_id = $${paramCount++}`);
    values.push(filters.section_id);
  }

  if (filters.status) {
    conditions.push(`status = $${paramCount++}`);
    values.push(filters.status);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY enrolled_at DESC';

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
  let countQuery = 'SELECT COUNT(*) FROM enrollments';
  const countConditions = [];
  const countValues = [];
  let countParamCount = 1;

  if (filters.student_id) {
    countConditions.push(`student_id = $${countParamCount++}`);
    countValues.push(filters.student_id);
  }

  if (filters.section_id) {
    countConditions.push(`section_id = $${countParamCount++}`);
    countValues.push(filters.section_id);
  }

  if (filters.status) {
    countConditions.push(`status = $${countParamCount++}`);
    countValues.push(filters.status);
  }

  if (countConditions.length > 0) {
    countQuery += ' WHERE ' + countConditions.join(' AND ');
  }

  const countResult = await pool.query(countQuery, countValues);

  return {
    enrollments: result.rows,
    total: parseInt(countResult.rows[0].count)
  };
}

/**
 * Update enrollment status
 */
async function updateEnrollmentStatus(enrollmentId, status) {
  const result = await pool.query(
    `UPDATE enrollments
     SET status = $1
     WHERE id = $2
     RETURNING *`,
    [status, enrollmentId]
  );
  return result.rows[0];
}

/**
 * Get student enrollments with section and course details
 */
async function getStudentEnrollmentsDetailed(studentId, status = null) {
  let query = `
    SELECT
      e.*,
      s.section_code,
      s.schedule,
      s.capacity,
      s.enrolled_count,
      c.id as course_id,
      c.code as course_code,
      c.name as course_name,
      c.units
    FROM enrollments e
    JOIN sections s ON e.section_id = s.id
    JOIN courses c ON s.course_id = c.id
    WHERE e.student_id = $1
  `;

  const values = [studentId];
  let paramCount = 2;

  if (status) {
    query += ` AND e.status = $${paramCount++}`;
    values.push(status);
  }

  query += ' ORDER BY e.enrolled_at DESC';

  const result = await pool.query(query, values);
  return result.rows;
}

module.exports = {
  createEnrollment,
  getEnrollmentById,
  isStudentEnrolled,
  listEnrollments,
  updateEnrollmentStatus,
  getStudentEnrollmentsDetailed,
  pool
};
