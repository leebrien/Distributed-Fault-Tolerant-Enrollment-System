const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();

app.use(express.json());

const PORT = 3000;
const SECRET_KEY = "supersecretdistributedsystemkey";
const BCRYPT_ROUNDS = 10;
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;
const PASSWORD_HISTORY_LIMIT = 5;
const MIN_PASSWORD_AGE_MS = 24 * 60 * 60 * 1000;
const REAUTH_TOKEN_TTL = "10m";
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
let activePoolRole = null;

async function establishConnection(config, roleLabel) {
    const candidatePool = new Pool(config);
    await candidatePool.query('SELECT 1');
    activePool = candidatePool;
    activePoolRole = roleLabel;
    console.log(`Auth-Service: Connected to ${roleLabel.toUpperCase()}.`);
}

async function connectPrimary() {
    console.log("Auth-Service: Attempting connection to PRIMARY...");
    await establishConnection(primaryConfig, 'primary');
}

async function connectDB() {
    try {
        await connectPrimary();
    } catch (err) {
        console.error("Auth-Service: PRIMARY failed.");
        console.warn("Auth-Service: Failover -> Switching to REPLICA...");

        try {
            await establishConnection(replicaConfig, 'replica');
        } catch (fatalErr) {
            console.error("Auth-Service: All databases are down.");
            activePool = null;
            activePoolRole = null;
        }
    }
}

const db = {
    query: async (text, params) => {
        if (!activePool) {
            await connectDB();
        }
        if (!activePool) {
            throw new Error("Database is offline");
        }
        return activePool.query(text, params);
    },
    writeQuery: async (text, params) => {
        if (activePoolRole !== 'primary') {
            await connectPrimary();
        }
        if (!activePool || activePoolRole !== 'primary') {
            throw new Error("Primary database is unavailable for write operations");
        }
        return activePool.query(text, params);
    },
    connectWriteClient: async () => {
        if (activePoolRole !== 'primary') {
            await connectPrimary();
        }
        if (!activePool || activePoolRole !== 'primary') {
            throw new Error("Primary database is unavailable for write operations");
        }
        return activePool.connect();
    }
};

function formatTimestamp(value) {
    return value ? new Date(value).toISOString() : null;
}

function validatePasswordComplexity(password) {
    return (
        typeof password === 'string' &&
        password.length >= 8 &&
        /[A-Z]/.test(password) &&
        /\d/.test(password) &&
        /[^A-Za-z0-9]/.test(password)
    );
}

function isBcryptHash(value) {
    return typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);
}

function sanitizeUser(user) {
    return {
        id: user.id,
        username: user.username,
        role: user.role,
        failedAttempts: user.failed_attempts,
        lockedUntil: formatTimestamp(user.locked_until),
        lastLoginAt: formatTimestamp(user.last_login_at),
        lastFailedLoginAt: formatTimestamp(user.last_failed_login_at),
        passwordChangedAt: formatTimestamp(user.password_changed_at),
        securityQuestionConfigured: Boolean(user.security_question && user.security_answer_hash)
    };
}

function sendPasswordComplexityError(res) {
    return res.status(400).json({ message: PASSWORD_COMPLEXITY_MESSAGE });
}

function createAuthToken(user, expiresIn = '1h', extraPayload = {}) {
    return jwt.sign(
        {
            id: user.id,
            role: user.role,
            username: user.username,
            ...extraPayload
        },
        SECRET_KEY,
        { expiresIn }
    );
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({ message: "Missing bearer token" });
    }

    try {
        req.user = jwt.verify(token, SECRET_KEY);
        next();
    } catch (err) {
        return res.status(401).json({ message: "Invalid or expired token" });
    }
}

async function ensurePasswordNotReused(client, studentId, candidatePassword, currentPasswordHash) {
    const historyResult = await client.query(
        `SELECT password_hash
         FROM password_history
         WHERE student_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2`,
        [studentId, PASSWORD_HISTORY_LIMIT]
    );

    const recentHashes = historyResult.rows.map((row) => row.password_hash);

    if (recentHashes.length === 0 && currentPasswordHash) {
        recentHashes.push(currentPasswordHash);
    }

    for (const hash of recentHashes) {
        if (await bcrypt.compare(candidatePassword, hash)) {
            return false;
        }
    }

    return true;
}

function isAccountLocked(user) {
    return user.locked_until && new Date(user.locked_until) > new Date();
}

async function clearExpiredLock(user) {
    if (!user.locked_until || isAccountLocked(user)) {
        return user;
    }

    const resetResult = await db.writeQuery(
        `UPDATE students
         SET failed_attempts = 0,
             locked_until = NULL
         WHERE id = $1
         RETURNING *`,
        [user.id]
    );

    return resetResult.rows[0];
}

async function fetchUserByUsername(username, forWrite = false) {
    const query = 'SELECT * FROM students WHERE username = $1';
    const result = forWrite
        ? await db.writeQuery(query, [username])
        : await db.query(query, [username]);

    return result.rows[0] || null;
}

async function fetchUserById(id, forWrite = false) {
    const query = 'SELECT * FROM students WHERE id = $1';
    const result = forWrite
        ? await db.writeQuery(query, [id])
        : await db.query(query, [id]);

    return result.rows[0] || null;
}

async function ensureAuthSchema() {
    const client = await db.connectWriteClient();

    try {
        await client.query('BEGIN');

        await client.query(`
            CREATE TABLE IF NOT EXISTS students (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(20) DEFAULT 'student'
            )
        `);

        await client.query(`
            ALTER TABLE students
                ALTER COLUMN password TYPE VARCHAR(255)
        `);

        await client.query(`
            ALTER TABLE students
                ADD COLUMN IF NOT EXISTS failed_attempts INT NOT NULL DEFAULT 0,
                ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP NULL,
                ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP NULL,
                ADD COLUMN IF NOT EXISTS last_failed_login_at TIMESTAMP NULL,
                ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP NULL,
                ADD COLUMN IF NOT EXISTS security_question VARCHAR(255),
                ADD COLUMN IF NOT EXISTS security_answer_hash VARCHAR(255)
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS password_history (
                id SERIAL PRIMARY KEY,
                student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);

        const studentResult = await client.query(`
            SELECT id, password, password_changed_at
            FROM students
            FOR UPDATE
        `);

        for (const student of studentResult.rows) {
            if (!isBcryptHash(student.password)) {
                const passwordHash = await bcrypt.hash(student.password, BCRYPT_ROUNDS);
                await client.query(
                    `UPDATE students
                     SET password = $2,
                         password_changed_at = COALESCE(password_changed_at, CURRENT_TIMESTAMP - INTERVAL '2 days')
                     WHERE id = $1`,
                    [student.id, passwordHash]
                );
            } else if (!student.password_changed_at) {
                await client.query(
                    `UPDATE students
                     SET password_changed_at = CURRENT_TIMESTAMP - INTERVAL '2 days'
                     WHERE id = $1`,
                    [student.id]
                );
            }
        }

        await client.query(`
            INSERT INTO password_history (student_id, password_hash)
            SELECT s.id, s.password
            FROM students s
            WHERE NOT EXISTS (
                SELECT 1
                FROM password_history ph
                WHERE ph.student_id = s.id
            )
        `);

        await client.query(`
            ALTER TABLE students
                ALTER COLUMN password_changed_at SET DEFAULT CURRENT_TIMESTAMP
        `);

        await client.query(`
            UPDATE students
            SET password_changed_at = CURRENT_TIMESTAMP - INTERVAL '2 days'
            WHERE password_changed_at IS NULL
        `);

        await client.query(`
            ALTER TABLE students
                ALTER COLUMN password_changed_at SET NOT NULL
        `);

        await client.query('COMMIT');
        console.log("Auth-Service: Schema migration complete.");
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function updatePasswordForUser(client, user, newPassword, options = {}) {
    const { enforceMinAge = true } = options;
    const isReusable = await ensurePasswordNotReused(client, user.id, newPassword, user.password);

    if (!isReusable) {
        return {
            ok: false,
            status: 400,
            body: { message: "New password must not match any of the last 5 passwords" }
        };
    }

    if (enforceMinAge && user.password_changed_at) {
        const passwordAgeMs = Date.now() - new Date(user.password_changed_at).getTime();
        if (passwordAgeMs < MIN_PASSWORD_AGE_MS) {
            return {
                ok: false,
                status: 429,
                body: {
                    message: "Password cannot be changed again until it is at least 1 day old",
                    passwordChangedAt: formatTimestamp(user.password_changed_at)
                }
            };
        }
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const updateResult = await client.query(
        `UPDATE students
         SET password = $2,
             password_changed_at = CURRENT_TIMESTAMP,
             failed_attempts = 0,
             locked_until = NULL
         WHERE id = $1
         RETURNING *`,
        [user.id, passwordHash]
    );

    await client.query(
        `INSERT INTO password_history (student_id, password_hash)
         VALUES ($1, $2)`,
        [user.id, passwordHash]
    );

    return {
        ok: true,
        user: updateResult.rows[0]
    };
}

app.post('/api/auth/register', async (req, res) => {
    const { username, password, role = 'student', securityQuestion, securityAnswer } = req.body;

    if (!username || !password || !securityQuestion || !securityAnswer) {
        return res.status(400).json({
            message: "Username, password, security question, and security answer are required"
        });
    }

    if (!validatePasswordComplexity(password)) {
        return sendPasswordComplexityError(res);
    }

    try {
        const client = await db.connectWriteClient();

        try {
            await client.query('BEGIN');

            const existingUserResult = await client.query(
                'SELECT id FROM students WHERE username = $1 FOR UPDATE',
                [username]
            );

            if (existingUserResult.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({ message: "Username already exists" });
            }

            const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
            const securityAnswerHash = await bcrypt.hash(securityAnswer, BCRYPT_ROUNDS);
            const insertResult = await client.query(
                `INSERT INTO students (
                    username,
                    password,
                    role,
                    security_question,
                    security_answer_hash,
                    password_changed_at
                 )
                 VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
                 RETURNING *`,
                [username, passwordHash, role, securityQuestion.trim(), securityAnswerHash]
            );

            await client.query(
                `INSERT INTO password_history (student_id, password_hash)
                 VALUES ($1, $2)`,
                [insertResult.rows[0].id, passwordHash]
            );

            await client.query('COMMIT');

            const user = insertResult.rows[0];
            const token = createAuthToken(user);

            return res.status(201).json({
                token,
                message: "Registration successful",
                user: sanitizeUser(user)
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Registration failed" });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
    }

    try {
        let user = await fetchUserByUsername(username, true);

        if (!user) {
            return res.status(401).json({ message: "Invalid credentials" });
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
            const failedAttempts = user.failed_attempts + 1;
            const shouldLock = failedAttempts >= LOCKOUT_THRESHOLD;
            const updateResult = await db.writeQuery(
                `UPDATE students
                 SET failed_attempts = $2,
                     locked_until = CASE
                         WHEN $3 THEN CURRENT_TIMESTAMP + INTERVAL '${LOCKOUT_MINUTES} minutes'
                         ELSE NULL
                     END,
                     last_failed_login_at = CURRENT_TIMESTAMP
                 WHERE id = $1
                 RETURNING failed_attempts, locked_until, last_failed_login_at`,
                [user.id, failedAttempts, shouldLock]
            );
            const failedLoginState = updateResult.rows[0];

            return res.status(shouldLock ? 423 : 401).json({
                message: shouldLock ? "Account is temporarily locked after repeated failed login attempts" : "Invalid credentials",
                failedAttempts: failedLoginState.failed_attempts,
                attemptsRemaining: Math.max(LOCKOUT_THRESHOLD - failedLoginState.failed_attempts, 0),
                lockedUntil: formatTimestamp(failedLoginState.locked_until),
                lastFailedLoginAt: formatTimestamp(failedLoginState.last_failed_login_at)
            });
        }

        const successResult = await db.writeQuery(
            `UPDATE students
             SET failed_attempts = 0,
                 locked_until = NULL,
                 last_login_at = CURRENT_TIMESTAMP
             WHERE id = $1
             RETURNING *`,
            [user.id]
        );
        const authenticatedUser = successResult.rows[0];
        const token = createAuthToken(authenticatedUser);

        return res.json({
            token,
            message: "Login successful",
            user: sanitizeUser(authenticatedUser)
        });
    } catch (err) {
        console.error(err);
        const message = err.message.includes('Primary database')
            ? "Authentication is temporarily unavailable"
            : "Database error";
        return res.status(500).json({ message });
    }
});

app.post('/api/auth/password-reset/challenge', async (req, res) => {
    const { username } = req.body;

    if (!username) {
        return res.status(400).json({ message: "Username is required" });
    }

    try {
        const user = await fetchUserByUsername(username);

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        if (!user.security_question || !user.security_answer_hash) {
            return res.status(400).json({ message: "Security question is not configured for this account" });
        }

        return res.json({
            username: user.username,
            securityQuestion: user.security_question
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Database error" });
    }
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

            const passwordUpdate = await updatePasswordForUser(client, user, newPassword, {
                enforceMinAge: false
            });

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
                   ) AS enrolled_courses
            FROM students s
            LEFT JOIN enrollments e ON s.id = e.student_id
            LEFT JOIN courses c ON e.course_id = c.id
            WHERE s.role = 'student'
            GROUP BY s.id, s.username
            ORDER BY s.id ASC;
        `;
        const result = await db.query(query);
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Database error" });
    }
});

async function bootstrap() {
    await connectDB();
    await ensureAuthSchema();
    app.listen(PORT, () => console.log(`Auth Service running on port ${PORT}`));
}

bootstrap().catch((err) => {
    console.error("Auth-Service bootstrap failed.", err);
    process.exit(1);
});
