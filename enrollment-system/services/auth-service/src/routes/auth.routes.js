const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticateToken } = require('../middleware/jwt.middleware');

// Public routes
router.post('/login', authController.login);

// Protected routes (require authentication)
router.post('/logout', authenticateToken, authController.logout);
router.get('/verify', authenticateToken, authController.verifyTokenEndpoint);
router.get('/me', authenticateToken, authController.getCurrentUser);

module.exports = router;
