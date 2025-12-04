const express = require('express');
const { Pool } = require('pg');
const app = express();

app.use(express.json());

// Connect to the Replica (Read-heavy operations) or Primary (Write operations)
const pool = new Pool({
    user: 'postgres',
    host: 'db-primary', // Simplified: Using Primary for both for now to avoid sync lag issues
    database: 'enrollment_db',
    password: 'password',
    port: 5432,
});

// GET: List all courses
app.get('/api/courses', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM courses');
        res.json({ node: "Course-Service-Node-1", data: result.rows });
    } catch (err) {
        res.status(500).json({ message: "Database error" });
    }
});

// POST: Enroll a student
app.post('/api/courses/enroll', async (req, res) => {
    const { studentId, courseId } = req.body;
    
    try {
        // 1. Check if course has space (Optional but good safety)
        const courseCheck = await pool.query('SELECT capacity FROM courses WHERE id = $1', [courseId]);
        if (courseCheck.rows[0].capacity <= 0) {
            return res.status(400).json({ message: "Course is full!" });
        }

        // 2. Insert Enrollment (This will fail if already enrolled due to UNIQUE constraint)
        await pool.query('INSERT INTO enrollments (student_id, course_id) VALUES ($1, $2)', [studentId, courseId]);

        // 3. DECREMENT CAPACITY (The missing piece!)
        await pool.query('UPDATE courses SET capacity = capacity - 1 WHERE id = $1', [courseId]);

        res.json({ message: "Enrollment Successful!" });
    } catch (err) {
        console.error(err);
        // Check duplicate error code (23505 is unique_violation in Postgres)
        if (err.code === '23505') {
            return res.status(400).json({ message: "You are already enrolled in this course." });
        }
        res.status(500).json({ message: "Enrollment failed." });
    }
});

app.listen(3001, () => console.log('Course Service running on port 3001'));