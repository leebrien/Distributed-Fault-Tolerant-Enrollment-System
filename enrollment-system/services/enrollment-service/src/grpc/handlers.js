const enrollmentModel = require('../models/enrollment.model');
const { courseServiceClient } = require('./clients');

/**
 * gRPC Handler: Create Enrollment
 */
async function CreateEnrollment(call, callback) {
  try {
    const { student_id, section_id } = call.request;

    // Check if already enrolled
    const alreadyEnrolled = await enrollmentModel.isStudentEnrolled(student_id, section_id);
    if (alreadyEnrolled) {
      return callback({
        code: 6, // ALREADY_EXISTS
        message: 'Student already enrolled in this section'
      });
    }

    // Check section availability via gRPC call to Course Service
    courseServiceClient.CheckSectionAvailability({ section_id }, async (error, availability) => {
      if (error) {
        console.error('gRPC error checking availability:', error);
        return callback({
          code: 13,
          message: 'Failed to check section availability'
        });
      }

      if (!availability.is_available) {
        return callback({
          code: 9, // FAILED_PRECONDITION
          message: availability.message || 'Section not available'
        });
      }

      // Create enrollment
      try {
        const enrollment = await enrollmentModel.createEnrollment(student_id, section_id);

        callback(null, {
          id: enrollment.id,
          student_id: enrollment.student_id,
          section_id: enrollment.section_id,
          status: enrollment.status,
          enrolled_at: enrollment.enrolled_at.toISOString()
        });
      } catch (err) {
        console.error('Create enrollment error:', err);
        callback({
          code: 13,
          message: err.message
        });
      }
    });
  } catch (error) {
    console.error('CreateEnrollment error:', error);
    callback({
      code: 13,
      message: error.message
    });
  }
}

/**
 * gRPC Handler: Get Enrollment
 */
async function GetEnrollment(call, callback) {
  try {
    const { enrollment_id } = call.request;
    const enrollment = await enrollmentModel.getEnrollmentById(enrollment_id);

    if (!enrollment) {
      return callback({
        code: 5,
        message: 'Enrollment not found'
      });
    }

    callback(null, {
      id: enrollment.id,
      student_id: enrollment.student_id,
      section_id: enrollment.section_id,
      status: enrollment.status,
      enrolled_at: enrollment.enrolled_at.toISOString()
    });
  } catch (error) {
    console.error('GetEnrollment error:', error);
    callback({
      code: 13,
      message: error.message
    });
  }
}

/**
 * gRPC Handler: List Enrollments
 */
async function ListEnrollments(call, callback) {
  try {
    const { student_id, section_id, status, limit, offset } = call.request;

    const filters = {
      student_id: student_id || null,
      section_id: section_id || null,
      status: status || null,
      limit: limit || 50,
      offset: offset || 0
    };

    const { enrollments, total } = await enrollmentModel.listEnrollments(filters);

    const enrollmentResponses = enrollments.map(enrollment => ({
      id: enrollment.id,
      student_id: enrollment.student_id,
      section_id: enrollment.section_id,
      status: enrollment.status,
      enrolled_at: enrollment.enrolled_at.toISOString()
    }));

    callback(null, {
      enrollments: enrollmentResponses,
      total
    });
  } catch (error) {
    console.error('ListEnrollments error:', error);
    callback({
      code: 13,
      message: error.message
    });
  }
}

/**
 * gRPC Handler: Update Enrollment Status
 */
async function UpdateEnrollmentStatus(call, callback) {
  try {
    const { enrollment_id, status } = call.request;

    const enrollment = await enrollmentModel.updateEnrollmentStatus(enrollment_id, status);

    if (!enrollment) {
      return callback({
        code: 5,
        message: 'Enrollment not found'
      });
    }

    callback(null, {
      id: enrollment.id,
      student_id: enrollment.student_id,
      section_id: enrollment.section_id,
      status: enrollment.status,
      enrolled_at: enrollment.enrolled_at.toISOString()
    });
  } catch (error) {
    console.error('UpdateEnrollmentStatus error:', error);
    callback({
      code: 13,
      message: error.message
    });
  }
}

/**
 * gRPC Handler: Get Student Enrollments
 */
async function GetStudentEnrollments(call, callback) {
  try {
    const { student_id, status } = call.request;

    const filters = {
      student_id,
      status: status || null,
      limit: 100,
      offset: 0
    };

    const { enrollments, total } = await enrollmentModel.listEnrollments(filters);

    const enrollmentResponses = enrollments.map(enrollment => ({
      id: enrollment.id,
      student_id: enrollment.student_id,
      section_id: enrollment.section_id,
      status: enrollment.status,
      enrolled_at: enrollment.enrolled_at.toISOString()
    }));

    callback(null, {
      enrollments: enrollmentResponses,
      total
    });
  } catch (error) {
    console.error('GetStudentEnrollments error:', error);
    callback({
      code: 13,
      message: error.message
    });
  }
}

module.exports = {
  CreateEnrollment,
  GetEnrollment,
  ListEnrollments,
  UpdateEnrollmentStatus,
  GetStudentEnrollments
};
