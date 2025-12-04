const express = require('express');
const router = express.Router();
const enrollmentController = require('../controllers/enrollment.controller');

// Enrollment routes
router.post('/', enrollmentController.createEnrollment);
router.get('/', enrollmentController.getEnrollments);
router.get('/student/:studentId', enrollmentController.getStudentEnrollments);
router.put('/:id', enrollmentController.updateEnrollmentStatus);
router.delete('/:id', enrollmentController.dropEnrollment);

module.exports = router;
