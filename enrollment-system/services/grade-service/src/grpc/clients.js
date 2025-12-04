const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const ENROLLMENT_SERVICE_GRPC = process.env.ENROLLMENT_SERVICE_GRPC || '172.28.0.23:5003';
const USER_SERVICE_GRPC = process.env.USER_SERVICE_GRPC || '172.28.0.25:5005';

// Load enrollment proto
const ENROLLMENT_PROTO_PATH = path.join(__dirname, '../../../proto/enrollment.proto');
const enrollmentPackageDef = protoLoader.loadSync(ENROLLMENT_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});
const enrollmentProto = grpc.loadPackageDefinition(enrollmentPackageDef).enrollment;

// Load user proto
const USER_PROTO_PATH = path.join(__dirname, '../../../proto/user.proto');
const userPackageDef = protoLoader.loadSync(USER_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});
const userProto = grpc.loadPackageDefinition(userPackageDef).user;

// Create clients
const enrollmentServiceClient = new enrollmentProto.EnrollmentService(
  ENROLLMENT_SERVICE_GRPC,
  grpc.credentials.createInsecure()
);

const userServiceClient = new userProto.UserService(
  USER_SERVICE_GRPC,
  grpc.credentials.createInsecure()
);

console.log(`✓ gRPC client connected to Enrollment Service at ${ENROLLMENT_SERVICE_GRPC}`);
console.log(`✓ gRPC client connected to User Service at ${USER_SERVICE_GRPC}`);

module.exports = {
  enrollmentServiceClient,
  userServiceClient
};
