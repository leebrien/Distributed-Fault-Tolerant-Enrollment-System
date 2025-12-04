const gradeModel = require('../models/grade.model');
const { enrollmentServiceClient } = require('./clients');

/**
 * gRPC Handler: Create Grade
 */
async function CreateGrade(call, callback) {
  try {
    const { enrollment_id, grade, remarks, updated_by } = call.request;

    // Verify enrollment exists via gRPC
    enrollmentServiceClient.GetEnrollment({ enrollment_id }, async (error, enrollment) => {
      if (error) {
        console.error('gRPC error:', error);
        return callback({
          code: 5,
          message: 'Enrollment not found'
        });
      }

      // Create or update grade
      try {
        const gradeRecord = await gradeModel.upsertGrade(enrollment_id, grade, remarks, updated_by);

        callback(null, {
          id: gradeRecord.id,
          enrollment_id: gradeRecord.enrollment_id,
          grade: parseFloat(gradeRecord.grade),
          remarks: gradeRecord.remarks || '',
          updated_by: gradeRecord.updated_by,
          updated_at: gradeRecord.updated_at.toISOString()
        });
      } catch (err) {
        console.error('Create grade error:', err);
        callback({
          code: 13,
          message: err.message
        });
      }
    });
  } catch (error) {
    console.error('CreateGrade error:', error);
    callback({
      code: 13,
      message: error.message
    });
  }
}

/**
 * gRPC Handler: Get Grade
 */
async function GetGrade(call, callback) {
  try {
    const { grade_id } = call.request;
    const grade = await gradeModel.getGradeById(grade_id);

    if (!grade) {
      return callback({
        code: 5,
        message: 'Grade not found'
      });
    }

    callback(null, {
      id: grade.id,
      enrollment_id: grade.enrollment_id,
      grade: parseFloat(grade.grade),
      remarks: grade.remarks || '',
      updated_by: grade.updated_by,
      updated_at: grade.updated_at.toISOString()
    });
  } catch (error) {
    console.error('GetGrade error:', error);
    callback({
      code: 13,
      message: error.message
    });
  }
}

/**
 * gRPC Handler: Get Grade by Enrollment
 */
async function GetGradeByEnrollment(call, callback) {
  try {
    const { enrollment_id } = call.request;
    const grade = await gradeModel.getGradeByEnrollmentId(enrollment_id);

    if (!grade) {
      return callback({
        code: 5,
        message: 'Grade not found'
      });
    }

    callback(null, {
      id: grade.id,
      enrollment_id: grade.enrollment_id,
      grade: parseFloat(grade.grade),
      remarks: grade.remarks || '',
      updated_by: grade.updated_by,
      updated_at: grade.updated_at.toISOString()
    });
  } catch (error) {
    console.error('GetGradeByEnrollment error:', error);
    callback({
      code: 13,
      message: error.message
    });
  }
}

/**
 * gRPC Handler: Update Grade
 */
async function UpdateGrade(call, callback) {
  try {
    const { grade_id, grade, remarks, updated_by } = call.request;

    const gradeRecord = await gradeModel.updateGrade(grade_id, grade, remarks, updated_by);

    if (!gradeRecord) {
      return callback({
        code: 5,
        message: 'Grade not found'
      });
    }

    callback(null, {
      id: gradeRecord.id,
      enrollment_id: gradeRecord.enrollment_id,
      grade: parseFloat(gradeRecord.grade),
      remarks: gradeRecord.remarks || '',
      updated_by: gradeRecord.updated_by,
      updated_at: gradeRecord.updated_at.toISOString()
    });
  } catch (error) {
    console.error('UpdateGrade error:', error);
    callback({
      code: 13,
      message: error.message
    });
  }
}

/**
 * gRPC Handler: List Student Grades
 */
async function ListStudentGrades(call, callback) {
  try {
    const { student_id } = call.request;
    const grades = await gradeModel.getStudentGrades(student_id);

    const gradeResponses = grades.map(grade => ({
      id: grade.id,
      enrollment_id: grade.enrollment_id,
      grade: parseFloat(grade.grade),
      remarks: grade.remarks || '',
      updated_by: grade.updated_by,
      updated_at: grade.updated_at.toISOString()
    }));

    callback(null, {
      grades: gradeResponses,
      total: grades.length
    });
  } catch (error) {
    console.error('ListStudentGrades error:', error);
    callback({
      code: 13,
      message: error.message
    });
  }
}

module.exports = {
  CreateGrade,
  GetGrade,
  GetGradeByEnrollment,
  UpdateGrade,
  ListStudentGrades
};
