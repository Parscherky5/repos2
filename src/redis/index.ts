import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

let redisClient: Redis | null = null;

if (config.redis.enabled) {
  redisClient = new Redis(config.redis.url, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    enableOfflineQueue: false,
  });
  redisClient.on('error', (err: Error) => logger.error('Redis error', { error: err.message }));
  redisClient.on('connect', () => logger.info('Redis connected'));
}

export async function rateLimitCheck(key: string, maxRequests: number, windowSeconds: number): Promise<boolean> {
  if (!redisClient) return true;
  try {
    const count = await redisClient.incr(key);
    if (count === 1) await redisClient.expire(key, windowSeconds);
    return count <= maxRequests;
  } catch (err) {
    logger.warn('Rate limit check failed, allowing', { key });
    return true;
  }
}

export async function isEmergencyStopActive(): Promise<boolean> {
  if (!redisClient) return false;
  try {
    const val = await redisClient.get('system:emergency_stop');
    return val === '1';
  } catch {
    return false;
  }
}

export async function setEmergencyStop(active: boolean): Promise<void> {
  if (!redisClient) return;
  if (active) {
    await redisClient.set('system:emergency_stop', '1');
  } else {
    await redisClient.del('system:emergency_stop');
  }
}

export { redisClient };