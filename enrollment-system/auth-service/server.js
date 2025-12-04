const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const app = express();

app.use(express.json());

const SECRET_KEY = "supersecretdistributedsystemkey";

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
    // 1. Try Primary
    try {
        console.log("🔌 Auth-Service: Attempting connection to PRIMARY...");
        const p = new Pool(primaryConfig);
        await p.query('SELECT 1'); // Test connection
        console.log("✅ Auth-Service: Connected to PRIMARY.");
        activePool = p;
    } catch (err) {
        console.error("❌ Auth-Service: Primary failed.");
        console.warn("⚠️  Auth-Service: Failover -> Switching to REPLICA...");
        
        // 2. Try Replica
        try {
            const r = new Pool(replicaConfig);
            await r.query('SELECT 1'); // Test connection
            console.log("✅ Auth-Service: Connected to REPLICA (Read-Only).");
            activePool = r;
        } catch (fatalErr) {
            console.error("💀 Auth-Service: All databases are down.");
            activePool = null;
        }
    }
}

// Initial connection attempt
connectDB();

// Wrapper so routes don't crash if DB is swapping
const pool = {
    query: async (text, params) => {
        if (!activePool) {
            await connectDB(); // Retry if null
        }
        if (!activePool) throw new Error("Database is offline");
        return activePool.query(text, params);
    }
};

// --- ROUTES ---

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        // Query (Works on Primary AND Replica)
        const result = await pool.query('SELECT * FROM students WHERE username = $1 AND password = $2', [username, password]);
        
        if (result.rows.length > 0) {
            const user = result.rows[0];
            const token = jwt.sign({ id: user.id, role: user.role }, SECRET_KEY, { expiresIn: '1h' });
            
            res.json({ 
                token, 
                message: "Login Successful", 
                user: { 
                    id: user.id, 
                    username: user.username, 
                    role: user.role 
                } 
            });
        } else {
            res.status(401).json({ message: "Invalid credentials" });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Database error" });
    }
});

// list students and their courses for faculty
app.get('/api/auth/students', async (req, res) => {
    try {
        const query = `
            SELECT s.id, s.username, 
                   COALESCE(
                       STRING_AGG(CONCAT(c.title, ' (ID: ', c.id, ')'), ', '), 
                       'None'
                   ) as enrolled_courses
            FROM students s
            LEFT JOIN enrollments e ON s.id = e.student_id
            LEFT JOIN courses c ON e.course_id = c.id
            WHERE s.role = 'student'
            GROUP BY s.id, s.username
            ORDER BY s.id ASC;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Database error" });
    }
});

app.listen(3000, () => console.log('Auth Service running on port 3000'));