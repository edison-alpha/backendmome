import { createClient } from 'redis';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
const REDIS_USERNAME = process.env.REDIS_USERNAME || 'default';
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || '';

console.log('🔧 Redis Config:', {
  host: REDIS_HOST,
  port: REDIS_PORT,
  username: REDIS_USERNAME,
  hasPassword: !!REDIS_PASSWORD
});

export const redis = createClient({
  username: REDIS_USERNAME,
  password: REDIS_PASSWORD,
  socket: {
    host: REDIS_HOST,
    port: REDIS_PORT,
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error('❌ Redis: Too many retries, giving up');
        return new Error('Too many retries');
      }
      const delay = Math.min(retries * 50, 2000);
      console.log(`🔄 Redis: Reconnecting in ${delay}ms...`);
      return delay;
    },
  },
});

redis.on('connect', () => {
  console.log('✅ Redis connected');
});

redis.on('error', (err) => {
  console.error('❌ Redis error:', err);
});

redis.on('ready', () => {
  console.log('✅ Redis ready');
});

// Connect to Redis
(async () => {
  try {
    await redis.connect();
  } catch (error) {
    console.error('❌ Failed to connect to Redis:', error);
  }
})();

// Cache helper functions
export const cacheService = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await redis.get(key);
      if (!cached) return null;
      return JSON.parse(cached) as T;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  },

  async set(key: string, value: any, ttl: number = 30): Promise<void> {
    try {
      // Redis v4 uses set with EX option instead of setex
      await redis.set(key, JSON.stringify(value), { EX: ttl });
    } catch (error) {
      console.error('Cache set error:', error);
    }
  },

  async del(key: string): Promise<void> {
    try {
      await redis.del(key);
    } catch (error) {
      console.error('Cache delete error:', error);
    }
  },

  async exists(key: string): Promise<boolean> {
    try {
      const result = await redis.exists(key);
      return result === 1;
    } catch (error) {
      console.error('Cache exists error:', error);
      return false;
    }
  },

  // Clear all cache - untuk reset saat deploy contract baru
  async flushAll(): Promise<boolean> {
    try {
      await redis.flushAll();
      console.log('✅ Redis cache cleared (FLUSHALL)');
      return true;
    } catch (error) {
      console.error('Cache flushAll error:', error);
      return false;
    }
  },

  // Clear cache by pattern (e.g., "raffle:*")
  async clearByPattern(pattern: string): Promise<number> {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(keys);
        console.log(`✅ Cleared ${keys.length} keys matching pattern: ${pattern}`);
      }
      return keys.length;
    } catch (error) {
      console.error('Cache clearByPattern error:', error);
      return 0;
    }
  },
};
