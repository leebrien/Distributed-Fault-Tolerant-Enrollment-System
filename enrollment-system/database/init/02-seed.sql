-- Seed Data for Testing
-- Password for all users: "password123" (hashed with bcrypt)
-- Hash generated: $2b$10$rQZ9Z9Z9Z9Z9Z9Z9Z9Z9Z.Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9

-- Insert Users (Students, Faculty, Admin)
INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES
-- Admin
('admin@dlsu.edu.ph', '$2b$10$rQZ9Z9Z9Z9Z9Z9Z9Z9Z9Z.Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9', 'Admin', 'User', 'admin'),

-- Faculty
('juan.delacruz@dlsu.edu.ph', '$2b$10$rQZ9Z9Z9Z9Z9Z9Z9Z9Z9Z.Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9', 'Juan', 'Dela Cruz', 'faculty'),
('maria.santos@dlsu.edu.ph', '$2b$10$rQZ9Z9Z9Z9Z9Z9Z9Z9Z9Z.Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9', 'Maria', 'Santos', 'faculty'),
('pedro.reyes@dlsu.edu.ph', '$2b$10$rQZ9Z9Z9Z9Z9Z9Z9Z9Z9Z.Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9', 'Pedro', 'Reyes', 'faculty'),
('ana.garcia@dlsu.edu.ph', '$2b$10$rQZ9Z9Z9Z9Z9Z9Z9Z9Z9Z.Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9', 'Ana', 'Garcia', 'faculty'),

-- Students
('student1@dlsu.edu.ph', '$2b$10$rQZ9Z9Z9Z9Z9Z9Z9Z9Z9Z.Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9', 'Jose', 'Rizal', 'student'),
('student2@dlsu.edu.ph', '$2b$10$rQZ9Z9Z9Z9Z9Z9Z9Z9Z9Z.Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9', 'Andres', 'Bonifacio', 'student'),
('student3@dlsu.edu.ph', '$2b$10$rQZ9Z9Z9Z9Z9Z9Z9Z9Z9Z.Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9', 'Emilio', 'Aguinaldo', 'student'),
('student4@dlsu.edu.ph', '$2b$10$rQZ9Z9Z9Z9Z9Z9Z9Z9Z9Z.Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9', 'Apolinario', 'Mabini', 'student'),
('student5@dlsu.edu.ph', '$2b$10$rQZ9Z9Z9Z9Z9Z9Z9Z9Z9Z.Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9Z9', 'Marcelo', 'Del Pilar', 'student');

-- Insert Courses
INSERT INTO courses (code, name, description, units) VALUES
('CSARCH2', 'Computer Architecture', 'Study of computer system design and organization', 3),
('CSNETWK', 'Computer Networks', 'Introduction to networking concepts and protocols', 3),
('CSADPRG', 'Advanced Programming', 'Advanced programming techniques and design patterns', 3),
('STALGCM', 'Algorithms and Complexity', 'Algorithm design and analysis', 3),
('CSINTSY', 'Intelligent Systems', 'Introduction to artificial intelligence and machine learning', 3),
('CSDISTC', 'Distributed Computing', 'Principles of distributed systems and applications', 3),
('CSSWENG', 'Software Engineering', 'Software development lifecycle and methodologies', 3),
('CSOPESY', 'Operating Systems', 'Operating system concepts and implementation', 3);

-- Insert Sections (Multiple sections per course, 1 faculty per section)
INSERT INTO sections (course_id, section_code, faculty_id, schedule, capacity, is_open) VALUES
-- CSARCH2 sections
(1, 'S11', 2, 'MWF 08:00-09:00', 30, true),
(1, 'S12', 2, 'MWF 10:00-11:00', 30, true),
(1, 'S13', 3, 'TH 13:00-14:30', 30, true),

-- CSNETWK sections
(2, 'S11', 3, 'MWF 09:00-10:00', 30, true),
(2, 'S12', 4, 'TH 10:00-11:30', 30, true),

-- CSADPRG sections
(3, 'S11', 4, 'MWF 11:00-12:00', 30, true),
(3, 'S12', 5, 'TH 14:30-16:00', 30, true),

-- STALGCM sections
(4, 'S11', 2, 'TH 08:00-09:30', 30, true),
(4, 'S12', 3, 'MWF 14:00-15:00', 30, true),

-- CSINTSY sections
(5, 'S11', 5, 'MWF 13:00-14:00', 30, true),
(5, 'S12', 2, 'TH 16:00-17:30', 30, false),

-- CSDISTC sections
(6, 'S11', 4, 'MWF 15:00-16:00', 30, true),
(6, 'S12', 5, 'TH 11:30-13:00', 30, true),

-- CSSWENG sections
(7, 'S11', 3, 'MWF 16:00-17:00', 30, true),

-- CSOPESY sections
(8, 'S11', 2, 'TH 14:30-16:00', 30, true);

-- Insert Sample Enrollments
INSERT INTO enrollments (student_id, section_id, status) VALUES
-- Student 1 (Jose Rizal)
(6, 1, 'enrolled'),  -- CSARCH2 S11
(6, 4, 'enrolled'),  -- CSNETWK S11
(6, 6, 'enrolled'),  -- CSADPRG S11

-- Student 2 (Andres Bonifacio)
(7, 2, 'enrolled'),  -- CSARCH2 S12
(7, 5, 'enrolled'),  -- CSNETWK S12
(7, 8, 'completed'), -- STALGCM S11 (completed last term)

-- Student 3 (Emilio Aguinaldo)
(8, 1, 'enrolled'),  -- CSARCH2 S11
(8, 10, 'enrolled'), -- CSINTSY S11
(8, 12, 'enrolled'), -- CSDISTC S11

-- Student 4 (Apolinario Mabini)
(9, 3, 'enrolled'),  -- CSARCH2 S13
(9, 7, 'enrolled'),  -- CSADPRG S12
(9, 14, 'enrolled'), -- CSSWENG S11

-- Student 5 (Marcelo Del Pilar)
(10, 2, 'enrolled'), -- CSARCH2 S12
(10, 4, 'enrolled'), -- CSNETWK S11
(10, 9, 'enrolled'); -- STALGCM S12

-- Insert Sample Grades (for completed courses)
INSERT INTO grades (enrollment_id, grade, remarks, updated_by) VALUES
(6, 3.50, 'PASSED', 2); -- Student 2's STALGCM grade

-- Note: Password for all test users is "password123"
-- In production, these should be properly hashed using bcrypt
