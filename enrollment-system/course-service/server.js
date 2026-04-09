const { checkValidation, validateCreateCourse, validateEnroll } = require('./middleware/validate');
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
    console.log(`Course-Service: Connected to ${roleLabel.toUpperCase()}.`);
}

async function connectPrimary() {
    console.log('Course-Service: Attempting connection to PRIMARY...');
    await establishConnection(primaryConfig, 'primary');
}

async function connectDB() {
    try {
        await connectPrimary();
    } catch (err) {
        console.error('Course-Service: PRIMARY failed.');
        console.warn('Course-Service: Failover -> Switching to REPLICA...');

        try {
            await establishConnection(replicaConfig, 'replica');
        } catch (fatalErr) {
            console.error('Course-Service: All databases are down.');
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

async function ensureCourseSchema() {
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

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.warn('Course-Service: Unable to run schema migration.', err.message);
    }
}

app.get('/api/courses', verifyToken(), async (req, res) => {
    try {
        let query = `
            SELECT c.id,
                   c.title,
                   c.description,
                   c.capacity,
                   c.faculty_id,
                   f.username AS faculty_username
            FROM courses c
            LEFT JOIN students f ON f.id = c.faculty_id
        `;
        let params = [];

        if (req.user.role === ROLES.STUDENT) {
            query += `
                WHERE c.id NOT IN (
                    SELECT course_id
                    FROM enrollments
                    WHERE student_id = $1
                )
            `;
            params = [req.user.id];
        } else if (req.user.role === ROLES.FACULTY) {
            query += ' WHERE c.faculty_id = $1';
            params = [req.user.id];
        }

        query += ' ORDER BY c.id ASC';

        const result = await pool.query(query, params);

        return res.json({
            node: 'Course-Service-Node-1',
            db_mode: getDbModeLabel(),
            data: result.rows
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Database error' });
    }
});

app.post('/api/courses', verifyToken(ROLES.ADMIN), validateCreateCourse, async (req, res) => {
    const invalid = checkValidation(req, res);
    if (invalid) {
        return;
    }

    const title = req.body.title.trim();
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
    const capacity = Number.parseInt(req.body.capacity, 10);
    const facultyId = req.body.facultyId === null || typeof req.body.facultyId === 'undefined'
        ? null
        : Number.parseInt(req.body.facultyId, 10);

    try {
        const client = await pool.connectWriteClient();

        try {
            await client.query('BEGIN');

            if (facultyId !== null) {
                const facultyResult = await client.query(
                    `SELECT id
                     FROM students
                     WHERE id = $1 AND role = $2`,
                    [facultyId, ROLES.FACULTY]
                );

                if (facultyResult.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({ message: 'Faculty account not found' });
                }
            }

            const insertResult = await client.query(
                `INSERT INTO courses (title, description, capacity, faculty_id)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id, title, description, capacity, faculty_id`,
                [title, description, capacity, facultyId]
            );

            await client.query('COMMIT');

            return res.status(201).json({
                message: 'Course created successfully',
                course: insertResult.rows[0]
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error(err);
        const message = err.message.includes('Primary database')
            ? 'Course creation is unavailable while the primary database is offline'
            : 'Unable to create course';
        return res.status(err.message.includes('Primary database') ? 503 : 500).json({ message });
    }
});

app.get('/api/courses/enrollments', verifyToken(ROLES.STUDENT), async (req, res) => {
    try {
        const result = await pool.query(
            `
                SELECT c.id,
                       c.title,
                       c.description,
                       c.capacity,
                       c.faculty_id,
                       f.username AS faculty_username,
                       e.enrolled_at
                FROM enrollments e
                JOIN courses c ON c.id = e.course_id
                LEFT JOIN students f ON f.id = c.faculty_id
                WHERE e.student_id = $1
                ORDER BY e.enrolled_at DESC, c.id ASC
            `,
            [req.user.id]
        );

        return res.json({
            node: 'Course-Service-Node-1',
            db_mode: getDbModeLabel(),
            data: result.rows
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Database error' });
    }
});

app.post('/api/courses/enroll', verifyToken(ROLES.STUDENT), validateEnroll, async (req, res) => {
    const invalid = checkValidation(req, res);
    if (invalid) {
        return;
    }

    const studentId = req.user.id;
    const { courseId } = req.body;

    try {
        const client = await pool.connectWriteClient();

        try {
            await client.query('BEGIN');

            const courseCheck = await client.query(
                `SELECT id, capacity
                 FROM courses
                 WHERE id = $1
                 FOR UPDATE`,
                [courseId]
            );

            if (courseCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ message: 'Course not found' });
            }

            if (courseCheck.rows[0].capacity <= 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: 'Course is full!' });
            }

            const existingEnrollment = await client.query(
                `SELECT 1
                 FROM enrollments
                 WHERE student_id = $1 AND course_id = $2`,
                [studentId, courseId]
            );

            if (existingEnrollment.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({ message: 'You are already enrolled in this course' });
            }

            await client.query(
                'INSERT INTO enrollments (student_id, course_id) VALUES ($1, $2)',
                [studentId, courseId]
            );
            await client.query(
                'UPDATE courses SET capacity = capacity - 1 WHERE id = $1',
                [courseId]
            );

            await client.query('COMMIT');

            return res.json({ message: 'Enrollment Successful!' });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error(err);
        const message = err.message.includes('Primary database')
            ? 'Enrollment FAILED: System is in Read-Only Mode.'
            : 'Enrollment failed.';
        return res.status(err.message.includes('Primary database') ? 503 : 500).json({ message });
    }
});

app.patch('/api/courses/:courseId/faculty', verifyToken(ROLES.ADMIN), async (req, res) => {
    const courseId = Number.parseInt(req.params.courseId, 10);
    const rawFacultyId = req.body.facultyId;
    const facultyId = rawFacultyId === null ? null : Number.parseInt(rawFacultyId, 10);

    if (!Number.isInteger(courseId) || courseId <= 0) {
        return res.status(400).json({ message: 'Course ID must be a positive integer' });
    }

    if (rawFacultyId !== null && (!Number.isInteger(facultyId) || facultyId <= 0)) {
        return res.status(400).json({ message: 'Faculty ID must be a positive integer or null' });
    }

    try {
        const client = await pool.connectWriteClient();

        try {
            await client.query('BEGIN');

            const courseResult = await client.query(
                'SELECT id FROM courses WHERE id = $1 FOR UPDATE',
                [courseId]
            );

            if (courseResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ message: 'Course not found' });
            }

            if (facultyId !== null) {
                const facultyResult = await client.query(
                    `SELECT id
                     FROM students
                     WHERE id = $1 AND role = $2`,
                    [facultyId, ROLES.FACULTY]
                );

                if (facultyResult.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({ message: 'Faculty account not found' });
                }
            }

            const updateResult = await client.query(
                `UPDATE courses
                 SET faculty_id = $2
                 WHERE id = $1
                 RETURNING id, title, description, capacity, faculty_id`,
                [courseId, facultyId]
            );

            await client.query('COMMIT');

            return res.json({
                message: 'Course faculty assignment updated successfully',
                course: updateResult.rows[0]
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error(err);
        const message = err.message.includes('Primary database')
            ? 'Course assignment is unavailable while the primary database is offline'
            : 'Unable to update course assignment';
        return res.status(err.message.includes('Primary database') ? 503 : 500).json({ message });
    }
});

async function bootstrap() {
    await connectDB();
    await ensureCourseSchema();
    app.listen(3001, () => console.log('Course Service running on port 3001'));
}

bootstrap().catch((err) => {
    console.error('Course-Service bootstrap failed.', err);
    process.exit(1);
});
