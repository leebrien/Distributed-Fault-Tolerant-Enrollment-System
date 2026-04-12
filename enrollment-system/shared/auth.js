const jwt = require('jsonwebtoken');
const { logEvent, EVENT_TYPES } = require('./logEvent');

const SECRET_KEY = process.env.JWT_SECRET || 'supersecretdistributedsystemkey';
const ROLES = Object.freeze({
    STUDENT: 'student',
    FACULTY: 'faculty',
    ADMIN: 'admin'
});

function normalizeRole(role) {
    return typeof role === 'string' ? role.trim().toLowerCase() : null;
}

function verifyToken(requiredRoles = []) {
    const allowedRoles = Array.isArray(requiredRoles)
        ? requiredRoles.map(normalizeRole).filter(Boolean)
        : [normalizeRole(requiredRoles)].filter(Boolean);

    return async (req, res, next) => {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

        if (!token) {
            await logEvent(EVENT_TYPES.ACCESS_DENIED, null, req,
                'Request made without a token');
            return res.status(401).json({ message: 'Missing bearer token' });
        }

        try {
            const payload = jwt.verify(token, SECRET_KEY);
            req.user = payload;

            if (allowedRoles.length > 0 && !allowedRoles.includes(normalizeRole(payload.role))) {
                await logEvent(EVENT_TYPES.ACCESS_DENIED, req.user.id, req,
                    `Role '${payload.role}' is not allowed on this route`);
                return res.status(403).json({ message: 'Forbidden' });
            }

            return next();
        } catch (err) {
            await logEvent(EVENT_TYPES.ACCESS_DENIED, null, req,
                'Invalid or expired token');
            return res.status(401).json({ message: 'Invalid or expired token' });
        }
    };
}

module.exports = {
    ROLES,
    SECRET_KEY,
    normalizeRole,
    verifyToken
};
