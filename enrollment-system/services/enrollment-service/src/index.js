require('dotenv').config();
const express = require('express');
const cors = require('cors');
const enrollmentRoutes = require('./routes/enrollment.routes');
const { startGrpcServer } = require('./grpc/server');
const { pool } = require('./models/enrollment.model');

const app = express();
const PORT = process.env.PORT || 4003;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'enrollment-service',
    timestamp: new Date().toISOString()
  });
});

// Routes
app.use('/api/enrollments', enrollmentRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start servers
async function startServer() {
  try {
    // Test database connection
    await pool.query('SELECT NOW()');
    console.log('✓ Database connection established');

    // Start gRPC server
    startGrpcServer();

    // Start REST API server
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✓ Enrollment Service (REST) running on port ${PORT}`);
      console.log(`✓ Service IP: 172.28.0.23`);
      console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
