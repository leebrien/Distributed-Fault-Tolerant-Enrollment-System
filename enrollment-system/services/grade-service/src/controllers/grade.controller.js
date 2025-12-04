const gradeModel = require('../models/grade.model');
const { enrollmentServiceClient } = require('../grpc/clients');

/**
 * Upload/Update grade (Faculty only)
 */
async function uploadGrade(req, res) {
  try {
    const { enrollment_id, grade, remarks, updated_by } = req.body;

    if (!enrollment_id || grade === undefined || !updated_by) {
      return res.status(400).json({ error: 'enrollment_id, grade, and updated_by are required' });
    }

    // Validate grade value (0.00 to 4.00)
    if (grade < 0 || grade > 4) {
      return res.status(400).json({ error: 'Grade must be between 0.00 and 4.00' });
    }

    // Verify enrollment exists via gRPC
    enrollmentServiceClient.GetEnrollment({ enrollment_id }, async (error, enrollment) => {
      if (error) {
        console.error('gRPC error:', error);
        return res.status(404).json({ error: 'Enrollment not found' });
      }

      // Create or update grade
      try {
        const gradeRecord = await gradeModel.upsertGrade(
          enrollment_id,
          grade,
          remarks || 'PASSED',
          updated_by
        );

        res.json({
          success: true,
          grade: gradeRecord
        });
      } catch (err) {
        console.error('Upload grade error:', err);
        res.status(500).json({ error: 'Failed to upload grade' });
      }
    });
  } catch (error) {
    console.error('Upload grade error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get student grades
 */
async function getStudentGrades(req, res) {
  try {
    const studentId = parseInt(req.params.studentId);
    const grades = await gradeModel.getStudentGrades(studentId);

    res.json({
      success: true,
      grades,
      total: grades.length
    });
  } catch (error) {
    console.error('Get student grades error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get grade by enrollment ID
 */
async function getGradeByEnrollment(req, res) {
  try {
    const enrollmentId = parseInt(req.params.enrollmentId);
    const grade = await gradeModel.getGradeByEnrollmentId(enrollmentId);

    if (!grade) {
      return res.status(404).json({ error: 'Grade not found' });
    }

    res.json({
      success: true,
      grade
    });
  } catch (error) {
    console.error('Get grade error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Update grade
 */
async function updateGrade(req, res) {
  try {
    const gradeId = parseInt(req.params.id);
    const { grade, remarks, updated_by } = req.body;

    if (grade === undefined || !updated_by) {
      return res.status(400).json({ error: 'grade and updated_by are required' });
    }

    // Validate grade value
    if (grade < 0 || grade > 4) {
      return res.status(400).json({ error: 'Grade must be between 0.00 and 4.00' });
    }

    const gradeRecord = await gradeModel.updateGrade(gradeId, grade, remarks, updated_by);

    if (!gradeRecord) {
      return res.status(404).json({ error: 'Grade not found' });
    }

    res.json({
      success: true,
      grade: gradeRecord
    });
  } catch (error) {
    console.error('Update grade error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  uploadGrade,
  getStudentGrades,
  getGradeByEnrollment,
  updateGrade
};
