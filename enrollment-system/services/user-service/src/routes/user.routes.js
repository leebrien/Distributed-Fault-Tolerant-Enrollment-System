const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');

// Note: Authentication middleware would be added by API gateway or shared middleware
// For now, these are unprotected for testing

router.get('/', userController.listUsers);
router.get('/:id', userController.getUser);
router.put('/:id', userController.updateUser);
router.post('/', userController.createUser);

module.exports = router;
