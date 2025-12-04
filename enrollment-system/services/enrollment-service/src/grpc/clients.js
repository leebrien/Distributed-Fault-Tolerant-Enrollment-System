const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const COURSE_SERVICE_GRPC = process.env.COURSE_SERVICE_GRPC || '172.28.0.22:5002';
const USER_SERVICE_GRPC = process.env.USER_SERVICE_GRPC || '172.28.0.25:5005';

// Load course proto
const COURSE_PROTO_PATH = path.join(__dirname, '../../../proto/course.proto');
const coursePackageDef = protoLoader.loadSync(COURSE_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});
const courseProto = grpc.loadPackageDefinition(coursePackageDef).course;

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
const courseServiceClient = new courseProto.CourseService(
  COURSE_SERVICE_GRPC,
  grpc.credentials.createInsecure()
);

const userServiceClient = new userProto.UserService(
  USER_SERVICE_GRPC,
  grpc.credentials.createInsecure()
);

console.log(`✓ gRPC client connected to Course Service at ${COURSE_SERVICE_GRPC}`);
console.log(`✓ gRPC client connected to User Service at ${USER_SERVICE_GRPC}`);

module.exports = {
  courseServiceClient,
  userServiceClient
};
