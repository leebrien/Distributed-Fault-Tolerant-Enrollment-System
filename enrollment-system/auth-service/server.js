const { checkValidation, validateLogin, validateRegister } = require('./middleware/validate');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const app = express();

app.use(express.json());

const SECRET_KEY = "supersecretdistributedsystemkey";
const BCRYPT_ROUNDS = 10;
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;
const PASSWORD_HISTORY_LIMIT = 5;
const MIN_PASSWORD_AGE_MS = 24 * 60 * 60 * 1000;
const REAUTH_TOKEN_TTL = "10m";
// Keep shared auth policy values centralized so login, reset, and re-auth flows stay aligned.
const PASSWORD_COMPLEXITY_MESSAGE =
    "Password must be at least 8 characters long and include one uppercase letter, one digit, and one special character.";

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

app.post('/api/auth/login', validateLogin, async (req, res) => {

    const invalid = checkValidation(req, res);
    if (invalid) return; // response already sent

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

// Registration route (new, Franz adds the full handler)
app.post('/api/auth/register', validateRegister, async (req, res) => {
  const invalid = checkValidation(req, res);
  if (invalid) return;
  // TODO (FRANZ)
});

app.post('/api/auth/password-reset', async (req, res) => {
    const { username, securityAnswer, newPassword } = req.body;

    if (!username || !securityAnswer || !newPassword) {
        return res.status(400).json({
            message: "Username, security answer, and new password are required"
        });
    }

    if (!validatePasswordComplexity(newPassword)) {
        return sendPasswordComplexityError(res);
    }

    try {
        const client = await db.connectWriteClient();

        try {
            await client.query('BEGIN');

            const userResult = await client.query(
                'SELECT * FROM students WHERE username = $1 FOR UPDATE',
                [username]
            );
            const user = userResult.rows[0];

            if (!user) {
                await client.query('ROLLBACK');
                return res.status(404).json({ message: "User not found" });
            }

            if (!user.security_question || !user.security_answer_hash) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: "Security question is not configured for this account" });
            }

            const answerMatches = await bcrypt.compare(securityAnswer, user.security_answer_hash);

            if (!answerMatches) {
                await client.query('ROLLBACK');
                return res.status(401).json({ message: "Security answer is incorrect" });
            }

            const passwordUpdate = await updatePasswordForUser(client, user, newPassword);

            if (!passwordUpdate.ok) {
                await client.query('ROLLBACK');
                return res.status(passwordUpdate.status).json(passwordUpdate.body);
            }

            await client.query('COMMIT');

            return res.json({
                message: "Password reset successful",
                user: sanitizeUser(passwordUpdate.user)
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Password reset failed" });
    }
});

app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Current password and new password are required" });
    }

    if (!validatePasswordComplexity(newPassword)) {
        return sendPasswordComplexityError(res);
    }

    try {
        const client = await db.connectWriteClient();

        try {
            await client.query('BEGIN');

            const userResult = await client.query(
                'SELECT * FROM students WHERE id = $1 FOR UPDATE',
                [req.user.id]
            );
            const user = userResult.rows[0];

            if (!user) {
                await client.query('ROLLBACK');
                return res.status(404).json({ message: "User not found" });
            }

            const passwordMatches = await bcrypt.compare(currentPassword, user.password);

            if (!passwordMatches) {
                await client.query('ROLLBACK');
                return res.status(401).json({ message: "Current password is incorrect" });
            }

            const passwordUpdate = await updatePasswordForUser(client, user, newPassword);

            if (!passwordUpdate.ok) {
                await client.query('ROLLBACK');
                return res.status(passwordUpdate.status).json(passwordUpdate.body);
            }

            await client.query('COMMIT');

            return res.json({
                message: "Password changed successfully",
                user: sanitizeUser(passwordUpdate.user)
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Password change failed" });
    }
});

app.post('/api/auth/security-question', authenticateToken, async (req, res) => {
    const { currentPassword, securityQuestion, securityAnswer } = req.body;

    if (!currentPassword || !securityQuestion || !securityAnswer) {
        return res.status(400).json({
            message: "Current password, security question, and security answer are required"
        });
    }

    try {
        const user = await fetchUserById(req.user.id, true);

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const passwordMatches = await bcrypt.compare(currentPassword, user.password);

        if (!passwordMatches) {
            return res.status(401).json({ message: "Current password is incorrect" });
        }

        const securityAnswerHash = await bcrypt.hash(securityAnswer, BCRYPT_ROUNDS);
        const updateResult = await db.writeQuery(
            `UPDATE students
             SET security_question = $2,
                 security_answer_hash = $3
             WHERE id = $1
             RETURNING *`,
            [user.id, securityQuestion.trim(), securityAnswerHash]
        );

        return res.json({
            message: "Security question updated successfully",
            user: sanitizeUser(updateResult.rows[0])
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Unable to update security question" });
    }
});

async function handleVerifyPassword(req, res) {
    const { password } = req.body;

    if (!password) {
        return res.status(400).json({ message: "Password is required" });
    }

    try {
        let user = await fetchUserById(req.user.id, true);

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        user = await clearExpiredLock(user);

        if (isAccountLocked(user)) {
            return res.status(423).json({
                message: "Account is temporarily locked",
                lockedUntil: formatTimestamp(user.locked_until)
            });
        }

        const passwordMatches = await bcrypt.compare(password, user.password);

        if (!passwordMatches) {
            return res.status(401).json({ message: "Password verification failed" });
        }

        const challengeToken = createAuthToken(
            user,
            REAUTH_TOKEN_TTL,
            { purpose: 'reauth' }
        );

        return res.json({
            message: "Password verified",
            challengeToken,
            expiresIn: REAUTH_TOKEN_TTL
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Unable to verify password" });
    }
}

app.post('/api/auth/verify-password', authenticateToken, handleVerifyPassword);
app.post('/api/auth/re-authenticate', authenticateToken, handleVerifyPassword);

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