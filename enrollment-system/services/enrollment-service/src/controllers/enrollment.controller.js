const enrollmentModel = require('../models/enrollment.model');
const { courseServiceClient, userServiceClient } = require('../grpc/clients');

/**
 * Create enrollment (Student enrolls in section)
 */
async function createEnrollment(req, res) {
  try {
    const { student_id, section_id } = req.body;

    if (!student_id || !section_id) {
      return res.status(400).json({ error: 'student_id and section_id are required' });
    }

    // Check if already enrolled
    const alreadyEnrolled = await enrollmentModel.isStudentEnrolled(student_id, section_id);
    if (alreadyEnrolled) {
      return res.status(409).json({ error: 'Student already enrolled in this section' });
    }

    // Check section availability via gRPC
    courseServiceClient.CheckSectionAvailability({ section_id }, async (error, availability) => {
      if (error) {
        console.error('gRPC error:', error);
        return res.status(500).json({ error: 'Failed to check section availability' });
      }

      if (!availability.is_available) {
        return res.status(400).json({
          error: availability.message || 'Section not available',
          remaining_slots: availability.remaining_slots
        });
      }

      // Create enrollment
      try {
        const enrollment = await enrollmentModel.createEnrollment(student_id, section_id);

        res.status(201).json({
          success: true,
          enrollment
        });
      } catch (err) {
        console.error('Create enrollment error:', err);
        res.status(500).json({ error: 'Failed to create enrollment' });
      }
    });
  } catch (error) {
    console.error('Create enrollment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get student enrollments
 */
async function getStudentEnrollments(req, res) {
  try {
    const studentId = parseInt(req.params.studentId);
    const { status } = req.query;

    const enrollments = await enrollmentModel.getStudentEnrollmentsDetailed(studentId, status);

    res.json({
      success: true,
      enrollments,
      total: enrollments.length
    });
  } catch (error) {
    console.error('Get student enrollments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get all enrollments (with filters)
 */
async function getEnrollments(req, res) {
  try {
    const { student_id, section_id, status, limit = 50, offset = 0 } = req.query;

    const filters = {
      student_id: student_id ? parseInt(student_id) : null,
      section_id: section_id ? parseInt(section_id) : null,
      status: status || null,
      limit: parseInt(limit),
      offset: parseInt(offset)
    };

    const { enrollments, total } = await enrollmentModel.listEnrollments(filters);

    res.json({
      success: true,
      enrollments,
      total,
      limit: filters.limit,
      offset: filters.offset
    });
  } catch (error) {
    console.error('Get enrollments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Update enrollment status (e.g., drop course)
 */
async function updateEnrollmentStatus(req, res) {
  try {
    const enrollmentId = parseInt(req.params.id);
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }

    const validStatuses = ['enrolled', 'dropped', 'completed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const enrollment = await enrollmentModel.updateEnrollmentStatus(enrollmentId, status);

    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    res.json({
      success: true,
      enrollment
    });
  } catch (error) {
    console.error('Update enrollment status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Drop enrollment (convenience endpoint)
 */
async function dropEnrollment(req, res) {
  try {
    const enrollmentId = parseInt(req.params.id);

    const enrollment = await enrollmentModel.updateEnrollmentStatus(enrollmentId, 'dropped');

    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    res.json({
      success: true,
      message: 'Enrollment dropped successfully',
      enrollment
    });
  } catch (error) {
    console.error('Drop enrollment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  createEnrollment,
  getStudentEnrollments,
  getEnrollments,
  updateEnrollmentStatus,
  dropEnrollment
};
