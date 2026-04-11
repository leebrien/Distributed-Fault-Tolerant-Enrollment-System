const { Pool } = require('pg');

const primaryConfig = {
    user: 'postgres',
    host: 'db-primary',
    database: 'enrollment_db',
    password: 'password',
    port: 5432,
};

// Logging always goes to primary
// we never log to replica
const logPool = new Pool(primaryConfig);

const EVENT_TYPES = Object.freeze({
    AUTH_SUCCESS:       'AUTH_SUCCESS',
    AUTH_FAILURE:       'AUTH_FAILURE',
    AUTH_LOCKOUT:       'AUTH_LOCKOUT',
    ACCESS_DENIED:      'ACCESS_DENIED',
    VALIDATION_FAILURE: 'VALIDATION_FAILURE',
    PASSWORD_CHANGE:    'PASSWORD_CHANGE',
    PASSWORD_RESET:     'PASSWORD_RESET',
});

async function logEvent(eventType, userId, req, details = '') {
    const ip = req?.headers?.['x-forwarded-for']?.split(',')[0].trim()
            || req?.socket?.remoteAddress
            || null;

    try {
        await logPool.query(
            `INSERT INTO audit_logs (user_id, event_type, ip_address, details)
             VALUES ($1, $2, $3, $4)`,
            [userId || null, eventType, ip, details] // userId can be null. we still have the ip
        );
    } catch (err) {
        // fail gracefully
        console.error('[logEvent] Failed to write audit log:', err.message);
    }
}

module.exports = { logEvent, EVENT_TYPES };