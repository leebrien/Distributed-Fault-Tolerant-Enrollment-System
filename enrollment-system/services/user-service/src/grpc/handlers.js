const bcrypt = require('bcrypt');
const userModel = require('../models/user.model');

/**
 * gRPC Handler: Get User by ID
 */
async function GetUser(call, callback) {
  try {
    const { user_id } = call.request;
    const user = await userModel.getUserById(user_id);

    if (!user) {
      return callback({
        code: 5, // NOT_FOUND
        message: 'User not found'
      });
    }

    callback(null, {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      role: user.role,
      created_at: user.created_at.toISOString(),
      password_hash: user.password_hash // Include for auth service validation
    });
  } catch (error) {
    console.error('GetUser error:', error);
    callback({
      code: 13, // INTERNAL
      message: error.message
    });
  }
}

/**
 * gRPC Handler: Get User by Email
 */
async function GetUserByEmail(call, callback) {
  try {
    const { email } = call.request;
    const user = await userModel.getUserByEmail(email);

    if (!user) {
      return callback({
        code: 5, // NOT_FOUND
        message: 'User not found'
      });
    }

    callback(null, {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      role: user.role,
      created_at: user.created_at.toISOString(),
      password_hash: user.password_hash
    });
  } catch (error) {
    console.error('GetUserByEmail error:', error);
    callback({
      code: 13,
      message: error.message
    });
  }
}

/**
 * gRPC Handler: Create User
 */
async function CreateUser(call, callback) {
  try {
    const { email, password, first_name, last_name, role } = call.request;

    // Check if user already exists
    const existingUser = await userModel.getUserByEmail(email);
    if (existingUser) {
      return callback({
        code: 6, // ALREADY_EXISTS
        message: 'User with this email already exists'
      });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // Create user
    const user = await userModel.createUser({
      email,
      password_hash,
      first_name,
      last_name,
      role
    });

    callback(null, {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      role: user.role,
      created_at: user.created_at.toISOString()
    });
  } catch (error) {
    console.error('CreateUser error:', error);
    callback({
      code: 13,
      message: error.message
    });
  }
}

/**
 * gRPC Handler: Update User
 */
async function UpdateUser(call, callback) {
  try {
    const { user_id, first_name, last_name, email } = call.request;

    const updates = {};
    if (first_name) updates.first_name = first_name;
    if (last_name) updates.last_name = last_name;
    if (email) updates.email = email;

    const user = await userModel.updateUser(user_id, updates);

    if (!user) {
      return callback({
        code: 5,
        message: 'User not found'
      });
    }

    callback(null, {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      role: user.role,
      created_at: user.created_at.toISOString()
    });
  } catch (error) {
    console.error('UpdateUser error:', error);
    callback({
      code: 13,
      message: error.message
    });
  }
}

/**
 * gRPC Handler: Validate User (for authentication)
 */
async function ValidateUser(call, callback) {
  try {
    const { email, password } = call.request;

    const user = await userModel.getUserByEmail(email);
    if (!user) {
      return callback(null, {
        valid: false
      });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);

    if (isValid) {
      callback(null, {
        valid: true,
        user: {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role,
          created_at: user.created_at.toISOString()
        }
      });
    } else {
      callback(null, {
        valid: false
      });
    }
  } catch (error) {
    console.error('ValidateUser error:', error);
    callback({
      code: 13,
      message: error.message
    });
  }
}

/**
 * gRPC Handler: List Users
 */
async function ListUsers(call, callback) {
  try {
    const { role, limit, offset } = call.request;

    const filters = {
      role: role || null,
      limit: limit || 50,
      offset: offset || 0
    };

    const { users, total } = await userModel.listUsers(filters);

    const userResponses = users.map(user => ({
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      role: user.role,
      created_at: user.created_at.toISOString()
    }));

    callback(null, {
      users: userResponses,
      total
    });
  } catch (error) {
    console.error('ListUsers error:', error);
    callback({
      code: 13,
      message: error.message
    });
  }
}

module.exports = {
  GetUser,
  GetUserByEmail,
  CreateUser,
  UpdateUser,
  ValidateUser,
  ListUsers
};
