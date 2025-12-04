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
        console.log("🔌 Grade-Service: Attempting connection to PRIMARY...");
        const p = new Pool(primaryConfig);
        await p.query('SELECT 1'); 
        console.log("✅ Grade-Service: Connected to PRIMARY.");
        activePool = p;
    } catch (err) {
        console.error("❌ Grade-Service: Primary failed.");
        console.warn("⚠️  Grade-Service: Failover -> Switching to REPLICA...");
        try {
            const r = new Pool(replicaConfig);
            await r.query('SELECT 1'); 
            console.log("✅ Grade-Service: Connected to REPLICA (Read-Only).");
            activePool = r;
        } catch (fatalErr) {
            console.error("💀 Grade-Service: All databases are down.");
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

// REQ 4: Student views previous grades (Will WORK on Replica)
app.get('/api/grades', async (req, res) => {
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
        
        // Added debug info
        const mode = activePool.options.host === 'db-primary' ? 'Primary' : 'Replica';
        res.json({ node: "Grade-Service-Node", db_mode: mode, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Database Error" });
    }
});

// REQ 5: Faculty uploads grades (Will FAIL on Replica)
app.post('/api/grades', async (req, res) => {
    const { studentId, courseId, grade } = req.body;
    
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
        
        // Handle Read-Only Replica Error
        if (err.message.includes('read-only transaction')) {
            return res.status(503).json({ message: "Cannot upload grades: Main Database is down (Read-Only Mode)." });
        }
        
        res.status(500).json({ message: "Failed to upload grade" });
    }
});

app.listen(3002, () => console.log('Grade Service running on port 3002'));