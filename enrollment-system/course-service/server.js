const express = require('express');
const { Pool } = require('pg');
const app = express();

app.use(express.json());

// --- DATABASE FAILOVER CONFIGURATION ---

const primaryConfig = {
    user: 'postgres',
    host: 'db-primary',
    database: 'enrollment_db',
    password: 'password',
    port: 5432,
};

const replicaConfig = {
    ...primaryConfig,
    host: 'db-replica',
};

let activePool = null;

async function connectDB() {
    try {
        console.log("🔌 Course-Service: Attempting connection to PRIMARY...");
        const p = new Pool(primaryConfig);
        await p.query('SELECT 1'); 
        console.log("✅ Course-Service: Connected to PRIMARY.");
        activePool = p;
    } catch (err) {
        console.error("❌ Course-Service: Primary failed.");
        console.warn("⚠️  Course-Service: Failover -> Switching to REPLICA...");
        try {
            const r = new Pool(replicaConfig);
            await r.query('SELECT 1'); 
            console.log("✅ Course-Service: Connected to REPLICA (Read-Only).");
            activePool = r;
        } catch (fatalErr) {
            console.error("💀 Course-Service: All databases are down.");
            activePool = null;
        }
    }
}

connectDB();

const pool = {
    query: async (text, params) => {
        if (!activePool) await connectDB();
        if (!activePool) throw new Error("Database is offline");
        return activePool.query(text, params);
    }
};

// --- ROUTES ---

// GET: List all courses (Will WORK on Replica)
app.get('/api/courses', async (req, res) => {
    const studentId = req.query.studentId;

    try {
        let query = 'SELECT * FROM courses';
        let params = [];

        // If a student is asking, exclude courses they are already in
        if (studentId) {
            query = `
                SELECT * FROM courses 
                WHERE id NOT IN (
                    SELECT course_id FROM enrollments WHERE student_id = $1
                )
            `;
            params = [studentId];
        }

        const result = await pool.query(query, params);
        // Added "Mode" to response so you can see which DB is answering in your test
        const mode = activePool.options.host === 'db-primary' ? 'Primary' : 'Replica (Read-Only)';
        res.json({ node: "Course-Service-Node-1", db_mode: mode, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Database error" });
    }
});

// POST: Enroll a student (Will FAIL on Replica - Read Only)
app.post('/api/courses/enroll', async (req, res) => {
    const { studentId, courseId } = req.body;
    
    try {
        // 1. Check if course has space 
        const courseCheck = await pool.query('SELECT capacity FROM courses WHERE id = $1', [courseId]);
        if (courseCheck.rows[0].capacity <= 0) {
            return res.status(400).json({ message: "Course is full!" });
        }

        // 2. Insert Enrollment 
        await pool.query('INSERT INTO enrollments (student_id, course_id) VALUES ($1, $2)', [studentId, courseId]);

        // 3. DECREMENT CAPACITY
        await pool.query('UPDATE courses SET capacity = capacity - 1 WHERE id = $1', [courseId]);

        res.json({ message: "Enrollment Successful!" });
    } catch (err) {
        console.error(err);
        
        // Handle Read-Only Replica Error
        if (err.message.includes('read-only transaction')) {
            return res.status(503).json({ message: "System is in maintenance mode (Read-Only). Try again later." });
        }

        if (err.code === '23505') {
            return res.status(400).json({ message: "You are already enrolled in this course." });
        }
        res.status(500).json({ message: "Enrollment failed." });
    }
});

app.listen(3001, () => console.log('Course Service running on port 3001'));