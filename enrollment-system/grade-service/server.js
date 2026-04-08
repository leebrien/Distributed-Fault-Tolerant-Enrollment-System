const { checkValidation, validateGrade, validateGradeQuery } = require('./middleware/validate');
const express = require('express');
const { Pool } = require('pg');
const { ROLES, verifyToken } = require('../shared/auth');

const app = express();

app.use(express.json());

const primaryConfig = {
    user: 'postgres',
    host: 'db-primary',
    database: 'enrollment_db',
    password: 'password',
    port: 5432
};

const replicaConfig = {
    ...primaryConfig,
    host: 'db-replica'
};

let activePool = null;
let activePoolRole = null;

async function establishConnection(config, roleLabel) {
    const candidatePool = new Pool(config);
    await candidatePool.query('SELECT 1');
    activePool = candidatePool;
    activePoolRole = roleLabel;
    console.log(`Grade-Service: Connected to ${roleLabel.toUpperCase()}.`);
}

async function connectPrimary() {
    console.log('Grade-Service: Attempting connection to PRIMARY...');
    await establishConnection(primaryConfig, 'primary');
}

async function connectDB() {
    try {
        await connectPrimary();
    } catch (err) {
        console.error('Grade-Service: PRIMARY failed.');
        console.warn('Grade-Service: Failover -> Switching to REPLICA...');

        try {
            await establishConnection(replicaConfig, 'replica');
        } catch (fatalErr) {
            console.error('Grade-Service: All databases are down.');
            activePool = null;
            activePoolRole = null;
        }
    }
}

const pool = {
    query: async (text, params) => {
        if (!activePool) {
            await connectDB();
        }
        if (!activePool) {
            throw new Error('Database is offline');
        }
        return activePool.query(text, params);
    },
    writeQuery: async (text, params) => {
        if (activePoolRole !== 'primary') {
            await connectPrimary();
        }
        if (!activePool || activePoolRole !== 'primary') {
            throw new Error('Primary database is unavailable for write operations');
        }
        return activePool.query(text, params);
    },
    connectWriteClient: async () => {
        if (activePoolRole !== 'primary') {
            await connectPrimary();
        }
        if (!activePool || activePoolRole !== 'primary') {
            throw new Error('Primary database is unavailable for write operations');
        }
        return activePool.connect();
    }
};

function getDbModeLabel() {
    return activePoolRole === 'primary' ? 'Primary' : 'Replica (Read-Only)';
}

async function ensureGradeSchema() {
    try {
        const client = await pool.connectWriteClient();

        try {
            await client.query('BEGIN');
            await client.query(`
                ALTER TABLE courses
                    ADD COLUMN IF NOT EXISTS faculty_id INT REFERENCES students(id)
            `);

            const facultyResult = await client.query(
                `SELECT id
                 FROM students
                 WHERE role = $1
                 ORDER BY id ASC
                 LIMIT 1`,
                [ROLES.FACULTY]
            );

            if (facultyResult.rows.length > 0) {
                await client.query(
                    `UPDATE courses
                     SET faculty_id = $1
                     WHERE faculty_id IS NULL`,
                    [facultyResult.rows[0].id]
                );
            }

            await client.query(
                `INSERT INTO enrollments (student_id, course_id)
                 SELECT g.student_id, g.course_id
                 FROM grades g
                 ON CONFLICT (student_id, course_id) DO NOTHING`
            );

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.warn('Grade-Service: Unable to run schema migration.', err.message);
    }
}

app.get('/api/grades', verifyToken(), validateGradeQuery, async (req, res) => {
    const invalid = checkValidation(req, res);
    if (invalid) {
        return;
    }

    const requestedStudentId = Number.parseInt(req.query.studentId, 10);
    const effectiveStudentId = req.user.role === ROLES.STUDENT ? req.user.id : requestedStudentId;

    if (!effectiveStudentId) {
        return res.status(400).json({ message: 'Student ID required' });
    }

    try {
        let query = `
            SELECT c.id AS course_id,
                   c.title,
                   g.grade,
                   g.student_id
            FROM grades g
            JOIN courses c ON g.course_id = c.id
            WHERE g.student_id = $1
        `;
        const params = [effectiveStudentId];

        if (req.user.role === ROLES.FACULTY) {
            query += ' AND c.faculty_id = $2';
            params.push(req.user.id);
        }

        query += ' ORDER BY c.id ASC';

        const result = await pool.query(query, params);

        return res.json({
            node: 'Grade-Service-Node',
            db_mode: getDbModeLabel(),
            data: result.rows
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Database Error' });
    }
});

app.post('/api/grades', verifyToken([ROLES.FACULTY, ROLES.ADMIN]), validateGrade, async (req, res) => {
    const invalid = checkValidation(req, res);
    if (invalid) {
        return;
    }

    const { studentId, courseId, grade } = req.body;

    try {
        const client = await pool.connectWriteClient();

        try {
            await client.query('BEGIN');

            const courseResult = await client.query(
                `SELECT id, faculty_id
                 FROM courses
                 WHERE id = $1
                 FOR UPDATE`,
                [courseId]
            );

            if (courseResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ message: 'Course not found' });
            }

            if (
                req.user.role === ROLES.FACULTY &&
                courseResult.rows[0].faculty_id !== req.user.id
            ) {
                await client.query('ROLLBACK');
                return res.status(403).json({ message: 'Forbidden' });
            }

            const studentResult = await client.query(
                `SELECT id
                 FROM students
                 WHERE id = $1 AND role = $2`,
                [studentId, ROLES.STUDENT]
            );

            if (studentResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ message: 'Student not found' });
            }

            const enrollmentResult = await client.query(
                `SELECT 1
                 FROM enrollments
                 WHERE student_id = $1 AND course_id = $2`,
                [studentId, courseId]
            );

            if (enrollmentResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: 'Student is not enrolled in this course' });
            }

            await client.query(
                `INSERT INTO grades (student_id, course_id, grade)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (student_id, course_id)
                 DO UPDATE SET grade = EXCLUDED.grade`,
                [studentId, courseId, grade]
            );

            await client.query('COMMIT');

            return res.json({ message: 'Grade uploaded successfully' });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error(err);
        const message = err.message.includes('Primary database')
            ? 'Cannot upload grades: Main Database is down (Read-Only Mode).'
            : 'Failed to upload grade';
        return res.status(err.message.includes('Primary database') ? 503 : 500).json({ message });
    }
});

async function bootstrap() {
    await connectDB();
    await ensureGradeSchema();
    app.listen(3002, () => console.log('Grade Service running on port 3002'));
}

bootstrap().catch((err) => {
    console.error('Grade-Service bootstrap failed.', err);
    process.exit(1);
});
