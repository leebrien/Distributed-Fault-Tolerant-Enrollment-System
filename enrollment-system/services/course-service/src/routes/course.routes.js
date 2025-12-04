const express = require('express');
const router = express.Router();
const courseController = require('../controllers/course.controller');

// Course routes
router.get('/', courseController.getCourses);
router.get('/:id', courseController.getCourse);
router.get('/:id/sections', courseController.getCourseSections);

// Section routes
router.get('/sections', courseController.getSections);
router.get('/sections/:id', courseController.getSection);
router.get('/sections/:id/availability', courseController.checkAvailability);

module.exports = router;
