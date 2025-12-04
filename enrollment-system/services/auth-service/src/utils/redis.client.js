const redis = require('redis');

const REDIS_HOST = process.env.REDIS_HOST || '172.28.0.32';
const REDIS_PORT = process.env.REDIS_PORT || 6379;

let redisClient = null;

/**
 * Initialize Redis client
 */
async function initRedis() {
  if (redisClient) return redisClient;

  redisClient = redis.createClient({
    socket: {
      host: REDIS_HOST,
      port: REDIS_PORT
    }
  });

  redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err);
  });

  redisClient.on('connect', () => {
    console.log(`✓ Connected to Redis at ${REDIS_HOST}:${REDIS_PORT}`);
  });

  await redisClient.connect();
  return redisClient;
}

/**
 * Store token in Redis with expiry (for blacklisting on logout)
 */
async function blacklistToken(token, expiresIn = 86400) {
  const client = await initRedis();
  await client.setEx(`blacklist:${token}`, expiresIn, 'true');
}

/**
 * Check if token is blacklisted
 */
async function isTokenBlacklisted(token) {
  const client = await initRedis();
  const result = await client.get(`blacklist:${token}`);
  return result === 'true';
}

/**
 * Store session data
 */
async function storeSession(userId, sessionData, expiresIn = 86400) {
  const client = await initRedis();
  await client.setEx(`session:${userId}`, expiresIn, JSON.stringify(sessionData));
}

/**
 * Get session data
 */
async function getSession(userId) {
  const client = await initRedis();
  const data = await client.get(`session:${userId}`);
  return data ? JSON.parse(data) : null;
}

/**
 * Delete session
 */
async function deleteSession(userId) {
  const client = await initRedis();
  await client.del(`session:${userId}`);
}

module.exports = {
  initRedis,
  blacklistToken,
  isTokenBlacklisted,
  storeSession,
  getSession,
  deleteSession
};
