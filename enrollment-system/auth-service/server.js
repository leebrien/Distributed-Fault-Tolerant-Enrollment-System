const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const app = express();

app.use(express.json());

const SECRET_KEY = "supersecretdistributedsystemkey";

// DB Failover Configs

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
    // Try Pimary DB first
    try {
        console.log("Attempting connection to PRIMARY...");
        const p = new Pool(primaryConfig);
        await p.query('SELECT 1');
        console.log("Connected to PRIMARY.");
        activePool = p;
    } catch (err) {
        console.error("Auth-Service: PRIMARY failed.");
        console.warn("Auth-Service: Failover -> Switching to REPLICA...");
        
        // Try Replica if Primary fails
        try {
            const r = new Pool(replicaConfig);
            await r.query('SELECT 1');
            console.log("Auth-Service: Connected to REPLICA (Read-Only).");
            activePool = r;
        } catch (fatalErr) {
            console.error("Auth-Service: All databases are down.");
            activePool = null;
        }
    }
}

// Connection attempt
connectDB();

const pool = {
    query: async (text, params) => {
        if (!activePool) {
            await connectDB();
        }
        if (!activePool) throw new Error("Database is offline");
        return activePool.query(text, params);
    }
};

// Routes

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