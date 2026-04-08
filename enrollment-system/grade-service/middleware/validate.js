const { body, query, validationResult } = require('express-validator');

// Reusable helper — call this at the top of every route handler
function checkValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }
  return null; // no errors
}

// Login
const validateLogin = [ 
  body('username')
    .isString().withMessage('Username must be a string.')
    .trim()
    .notEmpty().withMessage('Username is required.')
    .isLength({ max: 50 }).withMessage('Username must be 50 characters or fewer.'),

  body('password')
    .isString().withMessage('Password must be a string.')
    .notEmpty().withMessage('Password is required.')
    .isLength({ min: 8, max: 100 }).withMessage('Password must be between 8 and 100 characters.'),
];

// Registration
const validateRegister = [
  body('username')
    .isString().withMessage('Username must be a string.')
    .trim()
    .notEmpty().withMessage('Username is required.')
    .isLength({ min: 3, max: 50 }).withMessage('Username must be between 3 and 50 characters.')
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username may only contain letters, numbers, and underscores.'),

  body('password')
    .isString().withMessage('Password must be a string.')
    .isLength({ min: 8, max: 100 }).withMessage('Password must be at least 8 characters.')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter.')
    .matches(/[0-9]/).withMessage('Password must contain at least one number.')
    .matches(/[^a-zA-Z0-9]/).withMessage('Password must contain at least one special character.'),
];

// Enrollment
const validateEnroll = [
  body('studentId')
    .notEmpty().withMessage('Student ID is required.')
    .isInt({ min: 1 }).withMessage('Student ID must be a positive integer.'),

  body('courseId')
    .notEmpty().withMessage('Course ID is required.')
    .isInt({ min: 1 }).withMessage('Course ID must be a positive integer.'),
];

// Grade submission
const validateGrade = [
  body('studentId')
    .notEmpty().withMessage('Student ID is required.')
    .isInt({ min: 1 }).withMessage('Student ID must be a positive integer.'),

  body('courseId')
    .notEmpty().withMessage('Course ID is required.')
    .isInt({ min: 1 }).withMessage('Course ID must be a positive integer.'),

  body('grade')
    .notEmpty().withMessage('Grade is required.')
    .isFloat({ min: 0.0, max: 4.0 }).withMessage('Grade must be a number between 0.0 and 4.0.'),
];

// Grade query (GET request uses query params, not body)
const validateGradeQuery = [
  query('studentId')
    .notEmpty().withMessage('Student ID is required.')
    .isInt({ min: 1 }).withMessage('Student ID must be a positive integer.'),
];

module.exports = {
  checkValidation,
  validateLogin,
  validateRegister,
  validateEnroll,
  validateGrade,
  validateGradeQuery,
};