# Build and Testing Guide

## Phase 2 Complete! ✓

All microservices have been implemented with REST APIs and gRPC inter-service communication.

## Services Implemented

| Service | Status | REST Port | gRPC Port | Description |
|---------|--------|-----------|-----------|-------------|
| Auth Service | ✓ | 4001 | 5001 | JWT authentication, login/logout |
| User Service | ✓ | 4005 | 5005 | User management with gRPC |
| Course Service | ✓ | 4002 | 5002 | Course & section catalog |
| Enrollment Service | ✓ | 4003 | 5003 | Student enrollment (calls Course via gRPC) |
| Grade Service | ✓ | 4004 | 5004 | Grade management (calls Enrollment via gRPC) |

## gRPC Communication Flow

```
Frontend/Gateway (REST)
    ↓
Auth Service → User Service (gRPC)
    ↓
Enrollment Service → Course Service (gRPC)
    ↓
Grade Service → Enrollment Service (gRPC)
```

## Build and Run

### Step 1: Start the Infrastructure

```bash
cd enrollment-system

# Start database and Redis first
docker-compose up -d postgres-primary postgres-replica redis

# Wait for databases to initialize (about 30 seconds)
docker-compose logs -f postgres-primary

# Look for: "database system is ready to accept connections"
```

### Step 2: Start All Services

```bash
# Build and start everything
docker-compose up --build

# Or run in background
docker-compose up --build -d
```

### Step 3: Verify Services

```bash
# Check all containers are running
docker-compose ps

# Check individual service health
curl http://localhost/health                    # Gateway
curl http://localhost:4001/health               # Auth
curl http://localhost:4002/health               # Course
curl http://localhost:4003/health               # Enrollment
curl http://localhost:4004/health               # Grade
curl http://localhost:4005/health               # User
```

## Testing the APIs

### 1. Login (Auth Service)

```bash
curl -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "student1@dlsu.edu.ph",
    "password": "password123"
  }'
```

Expected response:
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 6,
    "email": "student1@dlsu.edu.ph",
    "firstName": "Jose",
    "lastName": "Rizal",
    "role": "student"
  }
}
```

Save the token for authenticated requests!

### 2. Verify Token

```bash
TOKEN="your_token_here"

curl http://localhost/api/auth/verify \
  -H "Authorization: Bearer $TOKEN"
```

### 3. Get All Courses (Course Service)

```bash
curl http://localhost/api/courses
```

### 4. Get Course Sections

```bash
# Get sections for CSARCH2 (course_id=1)
curl "http://localhost/api/courses/1/sections?is_open=true"
```

### 5. Enroll in a Section (Enrollment Service)

```bash
# Student enrolls in CSARCH2 S13 (section_id=3)
curl -X POST http://localhost/api/enrollments \
  -H "Content-Type: application/json" \
  -d '{
    "student_id": 6,
    "section_id": 3
  }'
```

### 6. Get Student Enrollments

```bash
# Get enrollments for student 6
curl http://localhost/api/enrollments/student/6
```

### 7. Upload Grade (Faculty - Grade Service)

```bash
# Faculty uploads grade for enrollment_id=1
curl -X POST http://localhost/api/grades \
  -H "Content-Type: application/json" \
  -d '{
    "enrollment_id": 1,
    "grade": 3.5,
    "remarks": "PASSED",
    "updated_by": 2
  }'
```

### 8. View Student Grades

```bash
# Get grades for student 6
curl http://localhost/api/grades/student/6
```

### 9. Logout

```bash
curl -X POST http://localhost/api/auth/logout \
  -H "Authorization: Bearer $TOKEN"
```

## Test Users

All passwords: `password123`

### Students
- student1@dlsu.edu.ph (Jose Rizal, ID: 6)
- student2@dlsu.edu.ph (Andres Bonifacio, ID: 7)
- student3@dlsu.edu.ph (Emilio Aguinaldo, ID: 8)

### Faculty
- juan.delacruz@dlsu.edu.ph (ID: 2)
- maria.santos@dlsu.edu.ph (ID: 3)
- pedro.reyes@dlsu.edu.ph (ID: 4)

### Admin
- admin@dlsu.edu.ph (ID: 1)

## Testing Fault Tolerance

### Test 1: Stop Course Service

```bash
# Stop the course service
docker-compose stop course-service

# Try to get courses - should fail gracefully
curl http://localhost/api/courses

# Other services should still work
curl http://localhost:4001/health  # Auth still works
curl http://localhost:4005/health  # User still works

# Restart course service
docker-compose start course-service
```

### Test 2: Stop Database Primary

```bash
# Stop primary database
docker-compose stop postgres-primary

# Services will fail for writes but replica is available for reads
# (Full failover would require additional configuration)

# Restart primary
docker-compose start postgres-primary
```

### Test 3: Stop Auth Service

```bash
# Stop auth service
docker-compose stop auth-service

# Login will fail
curl -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "student1@dlsu.edu.ph", "password": "password123"}'

# But other services still work (with existing tokens)
curl http://localhost/api/courses

# Restart auth
docker-compose start auth-service
```

## Debugging

### View Service Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f auth-service
docker-compose logs -f course-service
docker-compose logs -f enrollment-service
```

### Access Database

```bash
# Primary database
docker exec -it enrollment-db-primary psql -U postgres -d enrollment_db

# List tables
\dt

# Check users
SELECT * FROM users;

# Check enrollments
SELECT * FROM enrollments;

# Exit
\q
```

### Check Redis

```bash
# Access Redis CLI
docker exec -it enrollment-redis redis-cli

# List all keys
KEYS *

# Get a session
GET session:6

# Exit
exit
```

### Network Inspection

```bash
# Check network
docker network inspect enrollment-system_enrollment-network

# Check service IPs
docker inspect enrollment-auth | grep IPAddress
docker inspect enrollment-course | grep IPAddress
```

## Common Issues

### Port Already in Use

```bash
# Find process using port
lsof -i :4001

# Kill it
kill -9 <PID>
```

### Database Connection Failed

```bash
# Wait longer for database to initialize
docker-compose logs postgres-primary

# Or restart
docker-compose restart postgres-primary
```

### gRPC Connection Refused

```bash
# Make sure all services are running
docker-compose ps

# Check service logs
docker-compose logs enrollment-service

# Restart the service
docker-compose restart enrollment-service
```

### Proto File Not Found

```bash
# Rebuild with no cache
docker-compose build --no-cache <service-name>
docker-compose up <service-name>
```

## Clean Reset

```bash
# Stop everything
docker-compose down

# Remove volumes (deletes all data!)
docker-compose down -v

# Remove images
docker-compose down --rmi all

# Rebuild from scratch
docker-compose up --build
```

## Next Steps (Phase 3)

- [ ] Build React frontend
- [ ] Implement authentication flow in frontend
- [ ] Create student and faculty dashboards
- [ ] Add error handling and loading states
- [ ] Implement graceful degradation UI

## API Documentation

See [README.md](README.md) for complete API endpoint documentation.

## Success Criteria

✓ All services start without errors
✓ Database schema created with seed data
✓ gRPC communication working between services
✓ REST endpoints responding correctly
✓ JWT authentication functional
✓ Fault tolerance demonstrated
