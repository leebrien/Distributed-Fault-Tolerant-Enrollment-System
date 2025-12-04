const courseModel = require('../models/course.model');

/**
 * Get all courses
 */
async function getCourses(req, res) {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const filters = {
      limit: parseInt(limit),
      offset: parseInt(offset)
    };

    const { courses, total } = await courseModel.listCourses(filters);

    res.json({
      success: true,
      courses,
      total,
      limit: filters.limit,
      offset: filters.offset
    });
  } catch (error) {
    console.error('Get courses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get course by ID
 */
async function getCourse(req, res) {
  try {
    const courseId = parseInt(req.params.id);
    const course = await courseModel.getCourseById(courseId);

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    res.json({
      success: true,
      course
    });
  } catch (error) {
    console.error('Get course error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get sections for a course
 */
async function getCourseSections(req, res) {
  try {
    const courseId = parseInt(req.params.id);
    const { is_open } = req.query;

    const filters = {
      course_id: courseId,
      is_open: is_open !== undefined ? is_open === 'true' : null,
      limit: 100,
      offset: 0
    };

    const { sections, total } = await courseModel.listSections(filters);

    res.json({
      success: true,
      sections,
      total
    });
  } catch (error) {
    console.error('Get course sections error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get all sections
 */
async function getSections(req, res) {
  try {
    const { course_id, is_open, limit = 50, offset = 0 } = req.query;

    const filters = {
      course_id: course_id ? parseInt(course_id) : null,
      is_open: is_open !== undefined ? is_open === 'true' : null,
      limit: parseInt(limit),
      offset: parseInt(offset)
    };

    const { sections, total } = await courseModel.listSections(filters);

    res.json({
      success: true,
      sections,
      total,
      limit: filters.limit,
      offset: filters.offset
    });
  } catch (error) {
    console.error('Get sections error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get section by ID
 */
async function getSection(req, res) {
  try {
    const sectionId = parseInt(req.params.id);
    const section = await courseModel.getSectionById(sectionId);

    if (!section) {
      return res.status(404).json({ error: 'Section not found' });
    }

    res.json({
      success: true,
      section
    });
  } catch (error) {
    console.error('Get section error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Check section availability
 */
async function checkAvailability(req, res) {
  try {
    const sectionId = parseInt(req.params.id);
    const availability = await courseModel.checkSectionAvailability(sectionId);

    res.json({
      success: true,
      ...availability
    });
  } catch (error) {
    console.error('Check availability error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getCourses,
  getCourse,
  getCourseSections,
  getSections,
  getSection,
  checkAvailability
};
