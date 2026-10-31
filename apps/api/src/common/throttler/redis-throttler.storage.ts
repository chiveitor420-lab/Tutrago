import { Injectable, Inject, Optional } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../config/redis.provider';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private static memoryFallback = new Map<
    string,
    { hits: number; expiresAt: number; blockedUntil: number }
  >();

  constructor(
    @Optional() @Inject(REDIS_CLIENT) private readonly redisClient?: Redis
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string
  ): Promise<ThrottlerStorageRecord> {
    const redisKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `throttle:block:${throttlerName}:${key}`;
    const ttlSeconds = Math.max(1, Math.ceil(ttl / 1000));
    const blockSeconds = Math.max(1, Math.ceil((blockDuration || ttl) / 1000));

    if (this.redisClient && typeof (this.redisClient as any).incr === 'function') {
      try {
        const blockTtl = await (this.redisClient as any).ttl(blockKey);
        if (blockTtl > 0) {
          return {
            totalHits: limit + 1,
            timeToExpire: ttlSeconds,
            isBlocked: true,
            timeToBlockExpire: blockTtl,
          };
        }

        const totalHits = await (this.redisClient as any).incr(redisKey);
        if (totalHits === 1) {
          await (this.redisClient as any).expire(redisKey, ttlSeconds);
        }
        const currentTtl = await (this.redisClient as any).ttl(redisKey);
        const timeToExpire = currentTtl > 0 ? currentTtl : ttlSeconds;

        if (totalHits > limit) {
          await (this.redisClient as any).set(blockKey, '1', 'EX', blockSeconds);
          return {
            totalHits,
            timeToExpire,
            isBlocked: true,
            timeToBlockExpire: blockSeconds,
          };
        }

        return {
          totalHits,
          timeToExpire,
          isBlocked: false,
          timeToBlockExpire: 0,
        };
      } catch {
        // Si Redis parpadea, caer de forma transparente a memoria local
      }
    }

    const now = Date.now();
    const existing = RedisThrottlerStorage.memoryFallback.get(redisKey);

    if (existing && existing.blockedUntil > now) {
      return {
        totalHits: existing.hits,
        timeToExpire: Math.ceil(Math.max(1000, existing.expiresAt - now) / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil((existing.blockedUntil - now) / 1000),
      };
    }

    if (!existing || existing.expiresAt <= now) {
      const record = {
        hits: 1,
        expiresAt: now + ttlSeconds * 1000,
        blockedUntil: 0,
      };
      RedisThrottlerStorage.memoryFallback.set(redisKey, record);
      return {
        totalHits: 1,
        timeToExpire: ttlSeconds,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }

    existing.hits += 1;
    if (existing.hits > limit) {
      existing.blockedUntil = now + blockSeconds * 1000;
      return {
        totalHits: existing.hits,
        timeToExpire: Math.ceil(Math.max(1000, existing.expiresAt - now) / 1000),
        isBlocked: true,
        timeToBlockExpire: blockSeconds,
      };
    }

    return {
      totalHits: existing.hits,
      timeToExpire: Math.ceil(Math.max(1000, existing.expiresAt - now) / 1000),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}

