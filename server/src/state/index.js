/**
 * State repository factory.
 * Returns RedisStateRepository if REDIS_URL is set, else MemoryStateRepository.
 */

const MemoryStateRepository = require('./MemoryStateRepository');
const logger = require('../utils/logger');

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
        logger.error('Redis connection error', { error: err.message });
      });

      redis.on('connect', () => {
        // The logger masks the credentials in the URL automatically
        // (redis://:pass@host -> redis://***@host), so we can log the full
        // configured URL safely. The previous code masked it by hand with
        // a regex — that's now the logger's job.
        logger.info('Connected to Redis', { url: redisUrl });
      });

      const RedisStateRepository = require('./RedisStateRepository');
      return new RedisStateRepository(redis);
    } catch (e) {
      logger.warn('Failed to initialize Redis, falling back to in-memory state', { error: e.message });
    }
  }

  logger.info('Using in-memory state repository (set REDIS_URL for Redis)');
  return new MemoryStateRepository();
}

module.exports = { createStateRepository };
