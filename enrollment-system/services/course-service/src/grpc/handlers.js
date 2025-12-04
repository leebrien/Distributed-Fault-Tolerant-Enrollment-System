const courseModel = require('../models/course.model');

/**
 * gRPC Handler: Get Course
 */
async function GetCourse(call, callback) {
  try {
    const { course_id } = call.request;
    const course = await courseModel.getCourseById(course_id);

    if (!course) {
      return callback({
        code: 5, // NOT_FOUND
        message: 'Course not found'
      });
    }

    callback(null, {
      id: course.id,
      code: course.code,
      name: course.name,
      description: course.description || '',
      units: course.units
    });
  } catch (error) {
    console.error('GetCourse error:', error);
    callback({
      code: 13, // INTERNAL
      message: error.message
    });
  }
}

/**
 * gRPC Handler: List Courses
 */
async function ListCourses(call, callback) {
  try {
    const { limit, offset } = call.request;

    const filters = {
      limit: limit || 50,
      offset: offset || 0
    };

    const { courses, total } = await courseModel.listCourses(filters);

    const courseResponses = courses.map(course => ({
      id: course.id,
      code: course.code,
      name: course.name,
      description: course.description || '',
      units: course.units
    }));

    callback(null, {
      courses: courseResponses,
      total
    });
  } catch (error) {
    console.error('ListCourses error:', error);
    callback({
      code: 13,
      message: error.message
    });
  }
}

/**
 * gRPC Handler: Get Section
 */
async function GetSection(call, callback) {
  try {
    const { section_id } = call.request;
    const section = await courseModel.getSectionById(section_id);

    if (!section) {
      return callback({
        code: 5,
        message: 'Section not found'
      });
    }

    callback(null, {
      id: section.id,
      course_id: section.course_id,
      section_code: section.section_code,
      faculty_id: section.faculty_id || 0,
      schedule: section.schedule || '',
      capacity: section.capacity,
      enrolled_count: section.enrolled_count,
      is_open: section.is_open,
      course: {
        id: section.course_id,
        code: section.course_code,
        name: section.course_name,
        description: section.description || '',
        units: section.units
      }
    });
  } catch (error) {
    console.error('GetSection error:', error);
    callback({
      code: 13,
      message: error.message
    });
  }
}

/**
 * gRPC Handler: List Sections
 */
async function ListSections(call, callback) {
  try {
    const { course_id, is_open, limit, offset } = call.request;

    const filters = {
      course_id: course_id || null,
      is_open: is_open !== undefined ? is_open : null,
      limit: limit || 50,
      offset: offset || 0
    };

    const { sections, total } = await courseModel.listSections(filters);

    const sectionResponses = sections.map(section => ({
      id: section.id,
      course_id: section.course_id,
      section_code: section.section_code,
      faculty_id: section.faculty_id || 0,
      schedule: section.schedule || '',
      capacity: section.capacity,
      enrolled_count: section.enrolled_count,
      is_open: section.is_open,
      course: {
        id: section.course_id,
        code: section.course_code,
        name: section.course_name,
        description: section.description || '',
        units: section.units
      }
    }));

    callback(null, {
      sections: sectionResponses,
      total
    });
  } catch (error) {
    console.error('ListSections error:', error);
    callback({
      code: 13,
      message: error.message
    });
  }
}

/**
 * gRPC Handler: Check Section Availability
 */
async function CheckSectionAvailability(call, callback) {
  try {
    const { section_id } = call.request;
    const availability = await courseModel.checkSectionAvailability(section_id);

    callback(null, availability);
  } catch (error) {
    console.error('CheckSectionAvailability error:', error);
    callback({
      code: 13,
      message: error.message
    });
  }
}

/**
 * gRPC Handler: Update Enrollment Count
 */
async function UpdateEnrollmentCount(call, callback) {
  try {
    const { section_id, increment } = call.request;

    const section = await courseModel.updateEnrollmentCount(section_id, increment);

    callback(null, {
      success: true,
      new_count: section.enrolled_count
    });
  } catch (error) {
    console.error('UpdateEnrollmentCount error:', error);
    callback({
      code: 13,
      message: error.message
    });
  }
}

module.exports = {
  GetCourse,
  ListCourses,
  GetSection,
  ListSections,
  CheckSectionAvailability,
  UpdateEnrollmentCount
};
