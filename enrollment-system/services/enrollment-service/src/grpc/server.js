const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const handlers = require('./handlers');

const GRPC_PORT = process.env.GRPC_PORT || 5003;

// Load proto file
const PROTO_PATH = path.join(__dirname, '../../../proto/enrollment.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const enrollmentProto = grpc.loadPackageDefinition(packageDefinition).enrollment;

/**
 * Start gRPC server
 */
function startGrpcServer() {
  const server = new grpc.Server();

  // Add service with handlers
  server.addService(enrollmentProto.EnrollmentService.service, {
    CreateEnrollment: handlers.CreateEnrollment,
    GetEnrollment: handlers.GetEnrollment,
    ListEnrollments: handlers.ListEnrollments,
    UpdateEnrollmentStatus: handlers.UpdateEnrollmentStatus,
    GetStudentEnrollments: handlers.GetStudentEnrollments
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
      console.log(`✓ Enrollment Service (gRPC) running on port ${port}`);
      server.start();
    }
  );

  return server;
}

module.exports = { startGrpcServer };
