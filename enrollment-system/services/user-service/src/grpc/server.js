const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const handlers = require('./handlers');

const GRPC_PORT = process.env.GRPC_PORT || 5005;

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

/**
 * Start gRPC server
 */
function startGrpcServer() {
  const server = new grpc.Server();

  // Add service with handlers
  server.addService(userProto.UserService.service, {
    GetUser: handlers.GetUser,
    GetUserByEmail: handlers.GetUserByEmail,
    CreateUser: handlers.CreateUser,
    UpdateUser: handlers.UpdateUser,
    ValidateUser: handlers.ValidateUser,
    ListUsers: handlers.ListUsers
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
      console.log(`✓ User Service (gRPC) running on port ${port}`);
      server.start();
    }
  );

  return server;
}

module.exports = { startGrpcServer };
