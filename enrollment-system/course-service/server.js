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
        // Transaction: Add enrollment and decrease capacity (optional logic, kept simple here)
        await pool.query('INSERT INTO enrollments (student_id, course_id) VALUES ($1, $2)', [studentId, courseId]);
        res.json({ message: "Enrollment Successful!" });
    } catch (err) {
        console.error(err);
        res.status(400).json({ message: "Already enrolled or invalid ID" });
    }
});

app.listen(3001, () => console.log('Course Service running on port 3001'));