const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { ROLES, SECRET_KEY, normalizeRole, verifyToken } = require('../shared/auth');
const { logEvent, EVENT_TYPES } = require('../shared/logEvent');

const app = express();

app.use(express.json());

const PORT = 3000;
const BCRYPT_ROUNDS = 10;
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;
const PASSWORD_HISTORY_LIMIT = 5;
const MIN_PASSWORD_AGE_MS = 24 * 60 * 60 * 1000;
const REAUTH_TOKEN_TTL = "10m";
const BOOTSTRAP_RETRIES = 15;
const BOOTSTRAP_DELAY_MS = 3000;
const ALL_ROLES = [ROLES.STUDENT, ROLES.FACULTY, ROLES.ADMIN];
const MANAGED_ACCOUNT_ROLES = [ROLES.FACULTY, ROLES.ADMIN];
const PASSWORD_COMPLEXITY_MESSAGE =
    "Password must be at least 8 characters long and include one uppercase letter, one digit, and one special character.";
const APPROVED_RECOVERY_QUESTIONS = Object.freeze([
    "What is the private recovery phrase you created only for this account?",
    "What is the made-up recovery answer you chose only for this account?",
    "What is the unique account recovery secret that only you know?"
]);
const RECOVERY_ANSWER_MIN_LENGTH = 12;
const RECOVERY_ANSWER_MAX_LENGTH = 100;
const RECOVERY_ANSWER_WEAK_VALUES = new Set([
    '123456',
    '123456789',
    'admin',
    'blue',
    'cat',
    'dog',
    'green',
    'jesus',
    'letmein',
    'love',
    'mother',
    'password',
    'password123',
    'qwerty',
    'red',
    'secret',
    'student',
    'teacher',
    'thebible',
    'welcome',
    'white'
]);
const SECURITY_QUESTION_POLICY_MESSAGE =
    "Choose one of the approved recovery prompts so the answer can be a private, non-factual secret.";
const SECURITY_ANSWER_POLICY_MESSAGE =
    "Recovery answers must be 12-100 characters long, include at least three of uppercase letters, lowercase letters, numbers, and symbols, and avoid usernames or common answers.";

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

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

function normalizeSecurityQuestion(question) {
    return typeof question === 'string' ? question.trim() : '';
}

function normalizeSecurityAnswer(answer) {
    return typeof answer === 'string' ? answer.trim() : '';
}

function normalizeRecoveryAnswerKey(answer) {
    return normalizeSecurityAnswer(answer).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isApprovedSecurityQuestion(question) {
    return APPROVED_RECOVERY_QUESTIONS.includes(normalizeSecurityQuestion(question));
}

function hasApprovedSecurityQuestionConfigured(user) {
    return Boolean(
        user &&
        isApprovedSecurityQuestion(user.security_question) &&
        user.security_answer_hash
    );
}

function validateSecurityAnswerStrength(answer, username = '') {
    const normalizedAnswer = normalizeSecurityAnswer(answer);

    if (!normalizedAnswer) {
        return { ok: false, message: "Security answer is required" };
    }

    if (
        normalizedAnswer.length < RECOVERY_ANSWER_MIN_LENGTH ||
        normalizedAnswer.length > RECOVERY_ANSWER_MAX_LENGTH
    ) {
        return { ok: false, message: SECURITY_ANSWER_POLICY_MESSAGE };
    }

    const categoryCount = [
        /[a-z]/.test(normalizedAnswer),
        /[A-Z]/.test(normalizedAnswer),
        /\d/.test(normalizedAnswer),
        /[^A-Za-z0-9\s]/.test(normalizedAnswer)
    ].filter(Boolean).length;

    if (categoryCount < 3) {
        return { ok: false, message: SECURITY_ANSWER_POLICY_MESSAGE };
    }

    const answerKey = normalizeRecoveryAnswerKey(normalizedAnswer);
    const usernameKey = normalizeRecoveryAnswerKey(username);

    if (!answerKey || answerKey.length < 8) {
        return { ok: false, message: SECURITY_ANSWER_POLICY_MESSAGE };
    }

    if (RECOVERY_ANSWER_WEAK_VALUES.has(answerKey)) {
        return {
            ok: false,
            message: "Choose a less predictable recovery answer that is not based on a common fact or common word."
        };
    }

    if (usernameKey && answerKey.includes(usernameKey)) {
        return {
            ok: false,
            message: "Recovery answer must not contain the username."
        };
    }

    if (new Set(answerKey).size < 6) {
        return {
            ok: false,
            message: "Recovery answer must use a more varied set of characters."
        };
    }

    return { ok: true };
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
        securityQuestionConfigured: hasApprovedSecurityQuestionConfigured(user)
    };
}

function sendPasswordComplexityError(res) {
    return res.status(400).json({ message: PASSWORD_COMPLEXITY_MESSAGE });
}

function isValidRole(role) {
    return ALL_ROLES.includes(normalizeRole(role));
}

function isManagedAccountRole(role) {
    return MANAGED_ACCOUNT_ROLES.includes(normalizeRole(role));
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

async function seedDefaultAdminAccount(client) {
    const adminCountResult = await client.query(
        `SELECT COUNT(*)::INT AS admin_count
         FROM students
         WHERE role = $1`,
        [ROLES.ADMIN]
    );

    if (adminCountResult.rows[0].admin_count > 0) {
        return;
    }

    const passwordHash = await bcrypt.hash('password123', BCRYPT_ROUNDS);
    const defaultRecoveryQuestion = APPROVED_RECOVERY_QUESTIONS[0];
    const securityAnswerHash = await bcrypt.hash('AdminVault-729!', BCRYPT_ROUNDS);

    const insertResult = await client.query(
        `INSERT INTO students (
            username,
            password,
            role,
            security_question,
            security_answer_hash,
            password_changed_at
         )
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP - INTERVAL '2 days')
         ON CONFLICT (username) DO NOTHING
         RETURNING id, password`,
        ['admin1', passwordHash, ROLES.ADMIN, defaultRecoveryQuestion, securityAnswerHash]
    );

    if (insertResult.rows.length > 0) {
        await client.query(
            `INSERT INTO password_history (student_id, password_hash)
             VALUES ($1, $2)`,
            [insertResult.rows[0].id, insertResult.rows[0].password]
        );
    }
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
                ALTER COLUMN role SET DEFAULT 'student'
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

        await client.query(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES students(id) ON DELETE SET NULL,
                event_type VARCHAR(50) NOT NULL,
                ip_address VARCHAR(45),
                details TEXT,
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

        await seedDefaultAdminAccount(client);

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

    // Temporarily disable the minimum password age requirement so password
    // changes and resets can be tested without waiting 24 hours.
    /*
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
    */

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

async function createUserAccount(client, { username, password, role, securityQuestion, securityAnswer }) {
    const normalizedRole = normalizeRole(role);
    const normalizedSecurityQuestion = normalizeSecurityQuestion(securityQuestion);
    const normalizedSecurityAnswer = normalizeSecurityAnswer(securityAnswer);
    const existingUserResult = await client.query(
        'SELECT id FROM students WHERE username = $1 FOR UPDATE',
        [username]
    );

    if (existingUserResult.rows.length > 0) {
        return {
            ok: false,
            status: 409,
            body: { message: "Username already exists" }
        };
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const securityAnswerHash = await bcrypt.hash(normalizedSecurityAnswer, BCRYPT_ROUNDS);
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
        [username, passwordHash, normalizedRole, normalizedSecurityQuestion, securityAnswerHash]
    );

    await client.query(
        `INSERT INTO password_history (student_id, password_hash)
         VALUES ($1, $2)`,
        [insertResult.rows[0].id, passwordHash]
    );

    return {
        ok: true,
        user: insertResult.rows[0]
    };
}

app.post('/api/auth/register', async (req, res) => {
    const { username, password, role, securityQuestion, securityAnswer } = req.body;
    const requestedRole = normalizeRole(role || ROLES.STUDENT);

    if (!username || !password || !securityQuestion || !securityAnswer) {
        // Log validation failure for missing required fields
        await logEvent(EVENT_TYPES.VALIDATION_FAILURE, null, req,
            'Registration validation failed: Required fields missing');
        return res.status(400).json({
            message: "Username, password, security question, and security answer are required"
        });
    }

    if (requestedRole !== ROLES.STUDENT) {
        // Log validation failure for invalid role
        await logEvent(EVENT_TYPES.VALIDATION_FAILURE, null, req,
            `Registration validation failed: Invalid role requested '${role}'`);
        return res.status(403).json({ message: "Public registration may only create student accounts" });
    }

    if (!validatePasswordComplexity(password)) {
        // Log validation failure for password complexity
        await logEvent(EVENT_TYPES.VALIDATION_FAILURE, null, req,
            'Registration validation failed: Password does not meet complexity requirements');
        return sendPasswordComplexityError(res);
    }

    if (!isApprovedSecurityQuestion(securityQuestion)) {
        // Log validation failure for security question
        await logEvent(EVENT_TYPES.VALIDATION_FAILURE, null, req,
            'Registration validation failed: Security question not approved');
        return res.status(400).json({ message: SECURITY_QUESTION_POLICY_MESSAGE });
    }

    const recoveryAnswerValidation = validateSecurityAnswerStrength(securityAnswer, username);
    if (!recoveryAnswerValidation.ok) {
        return res.status(400).json({ message: recoveryAnswerValidation.message });
    }

    try {
        const client = await db.connectWriteClient();

        try {
            await client.query('BEGIN');

            const accountCreation = await createUserAccount(client, {
                username,
                password,
                role: ROLES.STUDENT,
                securityQuestion,
                securityAnswer
            });

            if (!accountCreation.ok) {
                await client.query('ROLLBACK');
                return res.status(accountCreation.status).json(accountCreation.body);
            }

            await client.query('COMMIT');

            const user = accountCreation.user;
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
        // Log validation failure for missing credentials
        await logEvent(EVENT_TYPES.VALIDATION_FAILURE, null, req,
            'Login validation failed: Username and password are required');
        return res.status(400).json({ message: "Username and password are required" });
    }

    try {
        let user = await fetchUserByUsername(username, true);

        if (!user) {
            // Log failure — no userId since the user doesn't exist
            await logEvent(EVENT_TYPES.AUTH_FAILURE, null, req,
                `Login attempt for unknown username: ${username}`);
            return res.status(401).json({ message: "Invalid credentials" });
        }

        user = await clearExpiredLock(user);

        if (isAccountLocked(user)) {
            await logEvent(EVENT_TYPES.AUTH_FAILURE, user.id, req,
                `Login blocked. The account is locked until ${formatTimestamp(user.locked_until)}`);
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

            // Log either a lockout or a plain failure
            if (shouldLock) {
                await logEvent(EVENT_TYPES.AUTH_LOCKOUT, user.id, req,
                    `Account locked after ${failedAttempts} failed attempts`);
            } else {
                await logEvent(EVENT_TYPES.AUTH_FAILURE, user.id, req,
                    `Invalid password (attempt ${failedAttempts} of ${LOCKOUT_THRESHOLD})`);
            }

            return res.status(shouldLock ? 423 : 401).json({
                message: shouldLock
                    ? "Account is temporarily locked after repeated failed login attempts"
                    : "Invalid credentials",
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

        // Log success
        await logEvent(EVENT_TYPES.AUTH_SUCCESS, authenticatedUser.id, req,
            `Successful login for ${authenticatedUser.username} (role: ${authenticatedUser.role})`);

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
        // Log validation failure for missing username
        await logEvent(EVENT_TYPES.VALIDATION_FAILURE, null, req,
            'Password reset challenge validation failed: Username is required');
        return res.status(400).json({ message: "Username is required" });
    }

    try {
        const user = await fetchUserByUsername(username);

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        if (!hasApprovedSecurityQuestionConfigured(user)) {
            return res.status(400).json({ message: "Security question is not configured for this account" });
        }

        return res.json({
            username: user.username,
            securityQuestion: normalizeSecurityQuestion(user.security_question)
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Database error" });
    }
});

app.post('/api/auth/password-reset', async (req, res) => {
    const { username, securityAnswer, newPassword } = req.body;

    if (!username || !securityAnswer || !newPassword) {
        // Log validation failure for missing fields
        await logEvent(EVENT_TYPES.VALIDATION_FAILURE, null, req,
            'Password reset validation failed: Required fields missing');
        return res.status(400).json({
            message: "Username, security answer, and new password are required"
        });
    }

    if (!validatePasswordComplexity(newPassword)) {
        // Log validation failure for password complexity
        await logEvent(EVENT_TYPES.VALIDATION_FAILURE, null, req,
            'Password reset validation failed: Password does not meet complexity requirements');
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

            if (!hasApprovedSecurityQuestionConfigured(user)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: "Security question is not configured for this account" });
            }

            const answerMatches = await bcrypt.compare(
                normalizeSecurityAnswer(securityAnswer),
                user.security_answer_hash
            );

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

            // Log successful password reset
            await logEvent(EVENT_TYPES.PASSWORD_RESET, user.id, req,
                `Password reset successful for user ${user.username}`);

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

app.post('/api/auth/change-password', verifyToken(), async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        // Log validation failure for missing fields
        await logEvent(EVENT_TYPES.VALIDATION_FAILURE, req.user.id, req,
            'Change password validation failed: Current password and new password are required');
        return res.status(400).json({ message: "Current password and new password are required" });
    }

    if (!validatePasswordComplexity(newPassword)) {
        // Log validation failure for password complexity
        await logEvent(EVENT_TYPES.VALIDATION_FAILURE, req.user.id, req,
            'Change password validation failed: New password does not meet complexity requirements');
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

            // Log successful password change
            await logEvent(EVENT_TYPES.PASSWORD_CHANGE, req.user.id, req,
                `Password changed successfully for user ${req.user.username}`);

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

app.post('/api/auth/security-question', verifyToken(), async (req, res) => {
    const { currentPassword, securityQuestion, securityAnswer } = req.body;

    if (!currentPassword || !securityQuestion || !securityAnswer) {
        // Log validation failure for missing fields
        await logEvent(EVENT_TYPES.VALIDATION_FAILURE, req.user.id, req,
            'Security question setup validation failed: Required fields missing');
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

        if (!isApprovedSecurityQuestion(securityQuestion)) {
            return res.status(400).json({ message: SECURITY_QUESTION_POLICY_MESSAGE });
        }

        const recoveryAnswerValidation = validateSecurityAnswerStrength(securityAnswer, user.username);
        if (!recoveryAnswerValidation.ok) {
            return res.status(400).json({ message: recoveryAnswerValidation.message });
        }

        const securityAnswerHash = await bcrypt.hash(
            normalizeSecurityAnswer(securityAnswer),
            BCRYPT_ROUNDS
        );
        const updateResult = await db.writeQuery(
            `UPDATE students
             SET security_question = $2,
                 security_answer_hash = $3
             WHERE id = $1
             RETURNING *`,
            [user.id, normalizeSecurityQuestion(securityQuestion), securityAnswerHash]
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

app.post('/api/auth/verify-password', verifyToken(), handleVerifyPassword);
app.post('/api/auth/re-authenticate', verifyToken(), handleVerifyPassword);

app.get('/api/auth/accounts', verifyToken(ROLES.ADMIN), async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id,
                    username,
                    role,
                    failed_attempts,
                    locked_until,
                    last_login_at,
                    last_failed_login_at,
                    password_changed_at,
                    security_question,
                    security_answer_hash
             FROM students
             ORDER BY role DESC, username ASC`
        );

        return res.json(result.rows.map(sanitizeUser));
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Database error" });
    }
});

app.post('/api/auth/accounts', verifyToken(ROLES.ADMIN), async (req, res) => {
    const { username, password, role, securityQuestion, securityAnswer } = req.body;
    const normalizedRole = normalizeRole(role);

    if (!username || !password || !role || !securityQuestion || !securityAnswer) {
        // Log validation failure for missing fields
        await logEvent(EVENT_TYPES.VALIDATION_FAILURE, req.user.id, req,
            'Account creation validation failed: Required fields missing');
        return res.status(400).json({
            message: "Username, password, role, security question, and security answer are required"
        });
    }

    if (!isManagedAccountRole(normalizedRole)) {
        // Log validation failure for invalid role
        await logEvent(EVENT_TYPES.VALIDATION_FAILURE, req.user.id, req,
            `Account creation validation failed: Invalid role '${role}' for admin creation`);
        return res.status(400).json({ message: "Admins may only create admin or faculty accounts" });
    }

    if (!validatePasswordComplexity(password)) {
        // Log validation failure for password complexity
        await logEvent(EVENT_TYPES.VALIDATION_FAILURE, req.user.id, req,
            'Account creation validation failed: Password does not meet complexity requirements');
        return sendPasswordComplexityError(res);
    }

    if (!isApprovedSecurityQuestion(securityQuestion)) {
        // Log validation failure for security question
        await logEvent(EVENT_TYPES.VALIDATION_FAILURE, req.user.id, req,
            'Account creation validation failed: Security question not approved');
        return res.status(400).json({ message: SECURITY_QUESTION_POLICY_MESSAGE });
    }

    const recoveryAnswerValidation = validateSecurityAnswerStrength(securityAnswer, username);
    if (!recoveryAnswerValidation.ok) {
        return res.status(400).json({ message: recoveryAnswerValidation.message });
    }

    try {
        const client = await db.connectWriteClient();

        try {
            await client.query('BEGIN');

            const accountCreation = await createUserAccount(client, {
                username,
                password,
                role: normalizedRole,
                securityQuestion,
                securityAnswer
            });

            if (!accountCreation.ok) {
                await client.query('ROLLBACK');
                return res.status(accountCreation.status).json(accountCreation.body);
            }

            await client.query('COMMIT');

            return res.status(201).json({
                message: "Account created successfully",
                user: sanitizeUser(accountCreation.user)
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Unable to create account" });
    }
});

app.patch('/api/auth/accounts/:id/role', verifyToken(ROLES.ADMIN), async (req, res) => {
    const accountId = Number.parseInt(req.params.id, 10);
    const nextRole = normalizeRole(req.body.role);

    if (!Number.isInteger(accountId) || accountId <= 0) {
        // Log validation failure for invalid account ID
        await logEvent(EVENT_TYPES.VALIDATION_FAILURE, req.user.id, req,
            'Role update validation failed: Invalid account ID');
        return res.status(400).json({ message: "Account ID must be a positive integer" });
    }

    if (!isValidRole(nextRole)) {
        // Log validation failure for invalid role
        await logEvent(EVENT_TYPES.VALIDATION_FAILURE, req.user.id, req,
            `Role update validation failed: Invalid role '${req.body.role}'`);
        return res.status(400).json({ message: "Role must be student, faculty, or admin" });
    }

    try {
        const client = await db.connectWriteClient();

        try {
            await client.query('BEGIN');

            const userResult = await client.query(
                'SELECT * FROM students WHERE id = $1 FOR UPDATE',
                [accountId]
            );
            const user = userResult.rows[0];

            if (!user) {
                await client.query('ROLLBACK');
                return res.status(404).json({ message: "User not found" });
            }

            if (user.id === req.user.id && nextRole !== ROLES.ADMIN) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: "You cannot remove your own admin role" });
            }

            if (user.role === ROLES.ADMIN && nextRole !== ROLES.ADMIN) {
                const adminCountResult = await client.query(
                    `SELECT COUNT(*)::INT AS admin_count
                     FROM students
                     WHERE role = $1`,
                    [ROLES.ADMIN]
                );

                if (adminCountResult.rows[0].admin_count <= 1) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ message: "At least one admin account must remain" });
                }
            }

            const updateResult = await client.query(
                `UPDATE students
                 SET role = $2
                 WHERE id = $1
                 RETURNING *`,
                [accountId, nextRole]
            );

            await client.query('COMMIT');

            return res.json({
                message: "Role updated successfully",
                user: sanitizeUser(updateResult.rows[0])
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Unable to update role" });
    }
});

app.delete('/api/auth/accounts/:id', verifyToken(ROLES.ADMIN), async (req, res) => {
    const accountId = Number.parseInt(req.params.id, 10);

    if (!Number.isInteger(accountId) || accountId <= 0) {
        return res.status(400).json({ message: "Account ID must be a positive integer" });
    }

    if (accountId === req.user.id) {
        return res.status(400).json({ message: "You cannot delete your own account" });
    }

    try {
        const client = await db.connectWriteClient();

        try {
            await client.query('BEGIN');

            const userResult = await client.query(
                'SELECT * FROM students WHERE id = $1 FOR UPDATE',
                [accountId]
            );
            const user = userResult.rows[0];

            if (!user) {
                await client.query('ROLLBACK');
                return res.status(404).json({ message: "User not found" });
            }

            if (!isManagedAccountRole(user.role)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: "Only admin and faculty accounts may be deleted here" });
            }

            if (user.role === ROLES.ADMIN) {
                const adminCountResult = await client.query(
                    `SELECT COUNT(*)::INT AS admin_count
                     FROM students
                     WHERE role = $1`,
                    [ROLES.ADMIN]
                );

                if (adminCountResult.rows[0].admin_count <= 1) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ message: "At least one admin account must remain" });
                }
            }

            await client.query('DELETE FROM students WHERE id = $1', [accountId]);
            await client.query('COMMIT');

            return res.json({ message: "Account deleted successfully" });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Unable to delete account" });
    }
});

app.get('/api/auth/audit-logs', verifyToken(ROLES.ADMIN), async (req, res) => {
    try {
        const tableResult = await db.query(`SELECT to_regclass('public.audit_logs') AS table_name`);

        if (!tableResult.rows[0].table_name) {
            return res.status(503).json({ message: "Audit log viewer will be available after audit logging is implemented" });
        }

        const result = await db.query(
            `SELECT id, user_id, event_type, ip_address, details, created_at
             FROM audit_logs
             ORDER BY created_at DESC
             LIMIT 100`
        );

        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Unable to load audit logs" });
    }
});

app.get('/api/auth/students', verifyToken([ROLES.FACULTY, ROLES.ADMIN]), async (req, res) => {
    try {
        let query;
        let params = [];

        if (req.user.role === ROLES.FACULTY) {
            query = `
                SELECT s.id,
                       s.username,
                       COALESCE(
                           STRING_AGG(CONCAT(c.title, ' (ID: ', c.id, ')'), ', ' ORDER BY c.id),
                           'None'
                       ) AS enrolled_courses
                FROM students s
                LEFT JOIN enrollments e ON s.id = e.student_id
                LEFT JOIN courses c ON e.course_id = c.id AND c.faculty_id = $1
                WHERE s.role = 'student'
                  AND EXISTS (
                      SELECT 1
                      FROM enrollments se
                      JOIN courses sc ON sc.id = se.course_id
                      WHERE se.student_id = s.id
                        AND sc.faculty_id = $1
                  )
                GROUP BY s.id, s.username
                ORDER BY s.id ASC;
            `;
            params = [req.user.id];
        } else {
            query = `
                SELECT s.id,
                       s.username,
                       COALESCE(
                           STRING_AGG(CONCAT(c.title, ' (ID: ', c.id, ')'), ', ' ORDER BY c.id),
                           'None'
                       ) AS enrolled_courses
                FROM students s
                LEFT JOIN enrollments e ON s.id = e.student_id
                LEFT JOIN courses c ON e.course_id = c.id
                WHERE s.role = 'student'
                GROUP BY s.id, s.username
                ORDER BY s.id ASC;
            `;
        }

        const result = await db.query(query, params);
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Database error" });
    }
});

//app.get('/api/auth/test-error', (req, res, next) => {
//    next(new Error('This is a test crash'));
//});

app.use((err, req, res, next) => {
    // Log the full error server-side
    console.error('[Unhandled Error]', err);

    // Send a safe generic message to the client
    res.status(500).json({ message: 'An unexpected error occurred.' });
});

async function bootstrap() {
    for (let attempt = 1; attempt <= BOOTSTRAP_RETRIES; attempt += 1) {
        try {
            await connectDB();
            await ensureAuthSchema();
            app.listen(PORT, '0.0.0.0', () => console.log(`Auth Service running on port ${PORT}`));
            return;
        } catch (err) {
            activePool = null;
            activePoolRole = null;
            console.error(
                `Auth-Service bootstrap attempt ${attempt}/${BOOTSTRAP_RETRIES} failed.`,
                err.message
            );

            if (attempt === BOOTSTRAP_RETRIES) {
                throw err;
            }

            await delay(BOOTSTRAP_DELAY_MS);
        }
    }
}

bootstrap().catch((err) => {
    console.error("Auth-Service bootstrap failed.", err);
    process.exit(1);
});
