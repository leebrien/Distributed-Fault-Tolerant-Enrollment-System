const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const USER_SERVICE_GRPC = process.env.USER_SERVICE_GRPC || '172.28.0.25:5005';

// Load proto file
const PROTO_PATH = path.join(__dirname, '../../../proto/user.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const userProto = grpc.loadPackageDefinition(packageDefinition).user;

// Create user service client
const userServiceClient = new userProto.UserService(
  USER_SERVICE_GRPC,
  grpc.credentials.createInsecure()
);

console.log(`✓ gRPC client connected to User Service at ${USER_SERVICE_GRPC}`);

module.exports = {
  userServiceClient
};
