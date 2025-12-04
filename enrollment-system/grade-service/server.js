const express = require('express');
const { Pool } = require('pg');
const app = express();

app.use(express.json());

const pool = new Pool({
    user: 'postgres',
    host: 'db-primary',
    database: 'enrollment_db',
    password: 'password',
    port: 5432,
});

// REQ 4: Student views previous grades
app.get('/api/grades', async (req, res) => {
    // In a real app, you'd get the student ID from the JWT middleware.
    // For this demo, we'll accept it as a query param or header, 
    // but let's assume the frontend passes the User ID.
    const studentId = req.query.studentId; 

    if (!studentId) return res.status(400).json({ message: "Student ID required" });

    try {
        const query = `
            SELECT c.title, g.grade 
            FROM grades g
            JOIN courses c ON g.course_id = c.id
            WHERE g.student_id = $1
        `;
        const result = await pool.query(query, [studentId]);
        res.json({ node: "Grade-Service-Node", data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Database Error" });
    }
});

// REQ 5: Faculty uploads grades
app.post('/api/grades', async (req, res) => {
    const { studentId, courseId, grade } = req.body;
    
    // Simple validation
    if (!studentId || !courseId || !grade) {
        return res.status(400).json({ message: "Missing fields" });
    }

    try {
        const query = `
            INSERT INTO grades (student_id, course_id, grade)
            VALUES ($1, $2, $3)
            ON CONFLICT (student_id, course_id) 
            DO UPDATE SET grade = EXCLUDED.grade;
        `;
        await pool.query(query, [studentId, courseId, grade]);
        res.json({ message: "Grade uploaded successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to upload grade" });
    }
});

app.listen(3002, () => console.log('Grade Service running on port 3002'));