const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const handlers = require('./handlers');

const GRPC_PORT = process.env.GRPC_PORT || 5002;

// Load proto file
const PROTO_PATH = path.join(__dirname, '../../../proto/course.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const courseProto = grpc.loadPackageDefinition(packageDefinition).course;

/**
 * Start gRPC server
 */
function startGrpcServer() {
  const server = new grpc.Server();

  // Add service with handlers
  server.addService(courseProto.CourseService.service, {
    GetCourse: handlers.GetCourse,
    ListCourses: handlers.ListCourses,
    GetSection: handlers.GetSection,
    ListSections: handlers.ListSections,
    CheckSectionAvailability: handlers.CheckSectionAvailability,
    UpdateEnrollmentCount: handlers.UpdateEnrollmentCount
  });

  // Bind and start server
  server.bindAsync(
    `0.0.0.0:${GRPC_PORT}`,
    grpc.ServerCredentials.createInsecure(),
    (error, port) => {
      if (error) {
        console.error('Failed to start gRPC server:', error);
        return;
      }
      console.log(`✓ Course Service (gRPC) running on port ${port}`);
      server.start();
    }
  );

  return server;
}

module.exports = { startGrpcServer };
