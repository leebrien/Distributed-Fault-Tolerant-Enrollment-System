CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'student',
    failed_attempts INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMP NULL,
    last_login_at TIMESTAMP NULL,
    last_failed_login_at TIMESTAMP NULL,
    password_changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    security_question VARCHAR(255),
    security_answer_hash VARCHAR(255)
);

ALTER TABLE students
    ALTER COLUMN password TYPE VARCHAR(255),
    ALTER COLUMN role SET DEFAULT 'student';

ALTER TABLE students
    ADD COLUMN IF NOT EXISTS failed_attempts INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP NULL,
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP NULL,
    ADD COLUMN IF NOT EXISTS last_failed_login_at TIMESTAMP NULL,
    ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP NULL,
    ADD COLUMN IF NOT EXISTS security_question VARCHAR(255),
    ADD COLUMN IF NOT EXISTS security_answer_hash VARCHAR(255);

UPDATE students
SET password_changed_at = CURRENT_TIMESTAMP - INTERVAL '2 days'
WHERE password_changed_at IS NULL;

ALTER TABLE students
    ALTER COLUMN password_changed_at SET DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS courses (
    id SERIAL PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    description TEXT,
    capacity INT DEFAULT 30
);

CREATE TABLE IF NOT EXISTS enrollments (
    id SERIAL PRIMARY KEY,
    student_id INT REFERENCES students(id),
    course_id INT REFERENCES courses(id),
    enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_id, course_id)
);

CREATE TABLE IF NOT EXISTS grades (
    id SERIAL PRIMARY KEY,
    student_id INT REFERENCES students(id),
    course_id INT REFERENCES courses(id),
    grade NUMERIC(3, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_id, course_id)
);

CREATE TABLE IF NOT EXISTS password_history (
    id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO students (
    username,
    password,
    role,
    password_changed_at,
    security_question,
    security_answer_hash
) VALUES
(
    'student1',
    '$2b$10$gIpa2jI22VbOJZoiw/SMEeqfGgPZl89kPSfsc7E.DKfwe6DfOWfIy',
    'student',
    CURRENT_TIMESTAMP - INTERVAL '2 days',
    'What city were you born in?',
    '$2b$10$3vr3eZaE1BuTWHTNzYv3Qeor1S/H4328BVWyJWTGe8Rc4M9q0Hbta'
),
(
    'student2',
    '$2b$10$Cg9CO0aY4FfFzNMzQiTu9OUiEkCihOewOL9tj10Scn89EL36kchD.',
    'student',
    CURRENT_TIMESTAMP - INTERVAL '2 days',
    'What is your favorite color?',
    '$2b$10$uZ9wdlU97gIZaTECqzrYIOTUsvvdfM9GT8VOy3Xh.S01ZUU0iETkW'
),
(
    'faculty1',
    '$2b$10$4/QD87DldO7KIDxmQ.anCewhZcngPMWVBRVJfi.f89ypU2G4ra4Pi',
    'faculty',
    CURRENT_TIMESTAMP - INTERVAL '2 days',
    'What is your favorite subject?',
    '$2b$10$.qRnoUkm9Yfaz0HWNWc2NOsOAHZIK5jDFSAK2pdtcLREo7DC/zKK2'
)
ON CONFLICT (username) DO NOTHING;

INSERT INTO password_history (student_id, password_hash)
SELECT s.id, s.password
FROM students s
WHERE NOT EXISTS (
    SELECT 1
    FROM password_history ph
    WHERE ph.student_id = s.id
);

INSERT INTO courses (title, description, capacity) VALUES
('Distributed Systems', 'Learn about Docker and Microservices', 30),
('Advanced Database', 'SQL optimization and replication', 25),
('Linear Algebra', 'Matrices and vectors', 40)
ON CONFLICT DO NOTHING;

INSERT INTO grades (student_id, course_id, grade) VALUES
(1, 1, 4.0),
(1, 2, 3.5)
ON CONFLICT DO NOTHING;
