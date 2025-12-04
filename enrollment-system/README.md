# Distributed Online Enrollment System

A distributed web-based enrollment system built with microservices architecture, demonstrating fault tolerance and service isolation using Docker containers.

## Architecture Overview

### Services and Network Configuration

| Service | IP Address | REST Port | gRPC Port | Description |
|---------|------------|-----------|-----------|-------------|
| Gateway | 172.28.0.10 | 80 | - | Nginx API Gateway |
| Frontend | 172.28.0.20 | 3000 | - | React View Layer |
| Auth Service | 172.28.0.21 | 4001 | 5001 | Authentication & JWT |
| Course Service | 172.28.0.22 | 4002 | 5002 | Course & Section Management |
| Enrollment Service | 172.28.0.23 | 4003 | 5003 | Student Enrollments |
| Grade Service | 172.28.0.24 | 4004 | 5004 | Grade Management |
| User Service | 172.28.0.25 | 4005 | 5005 | User Profiles |
| PostgreSQL Primary | 172.28.0.30 | 5432 | - | Main Database |
| PostgreSQL Replica | 172.28.0.31 | 5432 | - | Read Replica |
| Redis | 172.28.0.32 | 6379 | - | Session Store |

### Network

- **Subnet**: 172.28.0.0/16
- **Gateway**: 172.28.0.1

## Technology Stack

- **Frontend**: React + Vite
- **Backend**: Node.js + Express
- **Inter-service Communication**: gRPC + Protocol Buffers
- **API Gateway**: Nginx
- **Authentication**: JWT
- **Database**: PostgreSQL with Streaming Replication
- **Session Store**: Redis
- **Containerization**: Docker + Docker Compose

## Features

1. **Authentication**
   - Login/Logout with JWT
   - Session tracking across nodes via Redis
   - Role-based access (Student, Faculty, Admin)

2. **Course Management**
   - View available courses
   - Multiple sections per course
   - Faculty assignment per section

3. **Enrollment**
   - Students can enroll in open courses
   - Capacity management
   - Enrollment status tracking

4. **Grade Management**
   - Faculty can upload final grades
   - Students can view their grades
   - Grade history tracking

5. **Fault Tolerance**
   - Service isolation - each feature on its own node
   - Graceful degradation when services are down
   - Database replication for redundancy

## Prerequisites

- Docker Desktop or Docker Engine (20.10+)
- Docker Compose (2.0+)
- At least 4GB RAM available for containers
- Ports 80, 3000, 4001-4005, 5001-5005, 5432-5433, 6379 available

## Getting Started

### 1. Clone and Setup

```bash
cd enrollment-system
cp .env.example .env
```

### 2. Build and Start All Services

```bash
docker-compose up --build
```

This will:
- Build all service containers
- Create the custom network (172.28.0.0/16)
- Initialize PostgreSQL with schema and seed data
- Set up database replication
- Start all microservices

### 3. Access the Application

- **Web Application**: http://localhost
- **API Gateway**: http://localhost/health
- **Direct Frontend**: http://localhost:3000

### Test Credentials

All users have password: `password123`

**Students:**
- student1@dlsu.edu.ph
- student2@dlsu.edu.ph
- student3@dlsu.edu.ph
- student4@dlsu.edu.ph
- student5@dlsu.edu.ph

**Faculty:**
- juan.delacruz@dlsu.edu.ph
- maria.santos@dlsu.edu.ph
- pedro.reyes@dlsu.edu.ph
- ana.garcia@dlsu.edu.ph

**Admin:**
- admin@dlsu.edu.ph

## Development Commands

### Start Services
```bash
docker-compose up
```

### Start in Background
```bash
docker-compose up -d
```

### Stop Services
```bash
docker-compose down
```

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f auth-service
docker-compose logs -f postgres-primary
```

### Rebuild a Service
```bash
docker-compose up --build <service-name>
```

### Access Database
```bash
# Primary
docker exec -it enrollment-db-primary psql -U postgres -d enrollment_db

# Replica
docker exec -it enrollment-db-replica psql -U postgres -d enrollment_db
```

### Check Container Status
```bash
docker-compose ps
```

### Restart a Service
```bash
docker-compose restart <service-name>
```

## Testing Fault Tolerance

### Test Service Failure

Stop a specific service to test fault tolerance:

```bash
# Stop course service
docker-compose stop course-service

# Frontend should show "Course service unavailable" but other features work
# Restart it
docker-compose start course-service
```

### Test Database Failover

```bash
# Check replication status
docker exec -it enrollment-db-primary psql -U postgres -c "SELECT * FROM pg_stat_replication;"

# Stop primary (replica becomes read-only fallback)
docker-compose stop postgres-primary

# Services can still read from replica
# Restart primary
docker-compose start postgres-primary
```

## Project Structure

```
enrollment-system/
├── docker-compose.yml          # Service orchestration
├── .env                        # Environment variables
├── gateway/                    # Nginx API Gateway
├── frontend/                   # React frontend
├── proto/                      # gRPC proto definitions
├── services/                   # Microservices
│   ├── auth-service/
│   ├── user-service/
│   ├── course-service/
│   ├── enrollment-service/
│   └── grade-service/
├── database/                   # Database setup
│   ├── init/                   # Schema and seed data
│   ├── primary/                # Primary DB config
│   └── replica/                # Replica DB config
└── shared/                     # Shared utilities
```

## API Endpoints

### Auth Service (172.28.0.21:4001)
- POST `/api/auth/login` - User login
- POST `/api/auth/logout` - User logout
- GET `/api/auth/verify` - Verify JWT token

### User Service (172.28.0.25:4005)
- GET `/api/users/:id` - Get user profile
- PUT `/api/users/:id` - Update user profile

### Course Service (172.28.0.22:4002)
- GET `/api/courses` - List all courses
- GET `/api/courses/:id` - Get course details
- GET `/api/courses/:id/sections` - Get course sections

### Enrollment Service (172.28.0.23:4003)
- POST `/api/enrollments` - Enroll in section
- GET `/api/enrollments/student/:id` - Get student enrollments
- DELETE `/api/enrollments/:id` - Drop enrollment

### Grade Service (172.28.0.24:4004)
- POST `/api/grades` - Create/Update grade (Faculty)
- GET `/api/grades/student/:id` - Get student grades

## Troubleshooting

### Container Won't Start
```bash
# Check logs
docker-compose logs <service-name>

# Rebuild
docker-compose build --no-cache <service-name>
```

### Port Already in Use
```bash
# Find process using port
lsof -i :<port-number>

# Kill process
kill -9 <PID>
```

### Database Issues
```bash
# Reset database
docker-compose down -v
docker-compose up --build postgres-primary postgres-replica
```

### Network Issues
```bash
# Recreate network
docker-compose down
docker network prune
docker-compose up
```

## Phase 1 Complete ✓

Infrastructure is now ready:
- ✓ Docker Compose with explicit network stack
- ✓ PostgreSQL primary + replica
- ✓ Redis for session management
- ✓ Nginx API Gateway
- ✓ gRPC proto definitions
- ✓ Project structure

**Next Steps**: Implement the microservices (Phase 2-3)

## Contributors

DLSU - Distributed Computing Project

## License

Academic Project - DLSU
