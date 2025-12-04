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
 * Create grade
 */
async function createGrade(enrollmentId, grade, remarks, updatedBy) {
  const result = await pool.query(
    `INSERT INTO grades (enrollment_id, grade, remarks, updated_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [enrollmentId, grade, remarks, updatedBy]
  );
  return result.rows[0];
}

/**
 * Get grade by ID
 */
async function getGradeById(gradeId) {
  const result = await pool.query(
    'SELECT * FROM grades WHERE id = $1',
    [gradeId]
  );
  return result.rows[0];
}

/**
 * Get grade by enrollment ID
 */
async function getGradeByEnrollmentId(enrollmentId) {
  const result = await pool.query(
    'SELECT * FROM grades WHERE enrollment_id = $1',
    [enrollmentId]
  );
  return result.rows[0];
}

/**
 * Update grade
 */
async function updateGrade(gradeId, grade, remarks, updatedBy) {
  const result = await pool.query(
    `UPDATE grades
     SET grade = $1, remarks = $2, updated_by = $3, updated_at = CURRENT_TIMESTAMP
     WHERE id = $4
     RETURNING *`,
    [grade, remarks, updatedBy, gradeId]
  );
  return result.rows[0];
}

/**
 * Get student grades with course details
 */
async function getStudentGrades(studentId) {
  const result = await pool.query(
    `SELECT
      g.*,
      e.section_id,
      e.status as enrollment_status,
      s.section_code,
      s.schedule,
      c.id as course_id,
      c.code as course_code,
      c.name as course_name,
      c.units,
      u.first_name as faculty_first_name,
      u.last_name as faculty_last_name
    FROM grades g
    JOIN enrollments e ON g.enrollment_id = e.id
    JOIN sections s ON e.section_id = s.id
    JOIN courses c ON s.course_id = c.id
    LEFT JOIN users u ON g.updated_by = u.id
    WHERE e.student_id = $1
    ORDER BY g.updated_at DESC`,
    [studentId]
  );
  return result.rows;
}

/**
 * Get faculty sections for grade upload validation
 */
async function isFacultyOfSection(facultyId, sectionId) {
  const result = await pool.query(
    'SELECT * FROM sections WHERE id = $1 AND faculty_id = $2',
    [sectionId, facultyId]
  );
  return result.rows.length > 0;
}

/**
 * Upsert grade (create or update)
 */
async function upsertGrade(enrollmentId, grade, remarks, updatedBy) {
  const result = await pool.query(
    `INSERT INTO grades (enrollment_id, grade, remarks, updated_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (enrollment_id)
     DO UPDATE SET
       grade = EXCLUDED.grade,
       remarks = EXCLUDED.remarks,
       updated_by = EXCLUDED.updated_by,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [enrollmentId, grade, remarks, updatedBy]
  );
  return result.rows[0];
}

module.exports = {
  createGrade,
  getGradeById,
  getGradeByEnrollmentId,
  updateGrade,
  getStudentGrades,
  isFacultyOfSection,
  upsertGrade,
  pool
};
