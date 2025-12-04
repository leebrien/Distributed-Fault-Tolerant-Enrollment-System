const express = require('express');
const router = express.Router();
const gradeController = require('../controllers/grade.controller');

// Grade routes
router.post('/', gradeController.uploadGrade);
router.get('/student/:studentId', gradeController.getStudentGrades);
router.get('/enrollment/:enrollmentId', gradeController.getGradeByEnrollment);
router.put('/:id', gradeController.updateGrade);

module.exports = router;
