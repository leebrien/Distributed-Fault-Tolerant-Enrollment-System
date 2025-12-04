-- Create the Students Table
CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(50) NOT NULL, -- In production, hash this!
    role VARCHAR(20) DEFAULT 'student'
);

-- Create the Courses Table
CREATE TABLE IF NOT EXISTS courses (
    id SERIAL PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    description TEXT,
    capacity INT DEFAULT 30
);

-- Create Enrollments
CREATE TABLE IF NOT EXISTS enrollments (
    id SERIAL PRIMARY KEY,
    student_id INT REFERENCES students(id),
    course_id INT REFERENCES courses(id),
    enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_id, course_id) -- Prevent double enrollment
);

-- Create Grades Table
CREATE TABLE IF NOT EXISTS grades (
    id SERIAL PRIMARY KEY,
    student_id INT REFERENCES students(id),
    course_id INT REFERENCES courses(id),
    grade NUMERIC(3, 2), -- e.g., 95.50 or 4.00
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_id, course_id) -- One grade per course per student
);

-- some sample data
INSERT INTO students (username, password, role) VALUES 
('student1', 'password123', 'student'),
('student2', 'password123', 'student'),
('faculty1', 'password123', 'faculty') -- <--- THE NEW FACULTY USER
ON CONFLICT DO NOTHING;

INSERT INTO courses (title, description, capacity) VALUES 
('Distributed Systems', 'Learn about Docker and Microservices', 30),
('Advanced Database', 'SQL optimization and replication', 25),
('Linear Algebra', 'Matrices and vectors', 40)
ON CONFLICT DO NOTHING;

INSERT INTO grades (student_id, course_id, grade) VALUES 
(1, 1, 4.0), -- 4.0 in Distributed Systems
(1, 2, 3.5)  -- 3.5 in Advanced DB
ON CONFLICT DO NOTHING;
