/**
 * State repository factory.
 * Returns RedisStateRepository if REDIS_URL is set, else MemoryStateRepository.
 */

const MemoryStateRepository = require('./MemoryStateRepository');

function createStateRepository() {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    try {
      const Redis = require('ioredis');
      const redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        retryStrategy(times) {
          const delay = Math.min(times * 200, 5000);
          return delay;
        }
      });

      redis.on('error', (err) => {
        console.error('Redis connection error:', err.message);
      });

      redis.on('connect', () => {
        console.log('Connected to Redis:', redisUrl.replace(/\/\/.*@/, '//***@'));
      });

      const RedisStateRepository = require('./RedisStateRepository');
      return new RedisStateRepository(redis);
    } catch (e) {
      console.warn('Failed to initialize Redis, falling back to in-memory state:', e.message);
    }
  }

  console.log('Using in-memory state repository (set REDIS_URL for Redis)');
  return new MemoryStateRepository();
}

module.exports = { createStateRepository };
