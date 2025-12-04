const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const app = express();

app.use(express.json());

const SECRET_KEY = "supersecretdistributedsystemkey";

// Connect to the DB container
const pool = new Pool({
    user: 'postgres',
    host: 'db-primary',
    database: 'enrollment_db',
    password: 'password',
    port: 5432,
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        // Query
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

app.listen(3000, () => console.log('Auth Service running on port 3000'));