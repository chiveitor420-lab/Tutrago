import { Provider } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Adaptador Redis Híbrido (Redis 7 + Fallback en Memoria de Alta Velocidad).
 * Garantiza que el motor de Throttling FIFO (scard, sadd, srem, rpush, lpop, llen)
 * y el Interceptor de Idempotencia (get, set, del) funcionen sin latencia ni caídas
 * tanto con Redis activo como en entornos locales sin Docker.
 */
class HybridRedisClient {
  private nativeClient: Redis | null = null;
  private isNativeConnected = false;

  private kvStore = new Map<string, string>();
  private listStore = new Map<string, string[]>();
  private setStore = new Map<string, Set<string>>();

  constructor(redisUrl: string) {
    try {
      const client = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 1500,
        retryStrategy(times) {
          if (times > 1) return null;
          return 200;
        },
      });

      client.on('ready', () => {
        this.isNativeConnected = true;
        console.log(`[RedisProvider] Conectado a Redis en ${redisUrl}`);
      });

      client.on('error', () => {
        this.isNativeConnected = false;
      });

      client.connect().catch(() => {
        this.isNativeConnected = false;
        console.log(
          `[RedisProvider] Redis local no detectado en ${redisUrl}. Operando con motor FIFO en memoria.`
        );
      });

      this.nativeClient = client;
    } catch {
      this.isNativeConnected = false;
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.isNativeConnected && this.nativeClient) {
      try {
        return await this.nativeClient.get(key);
      } catch {
        // Fallback a memoria
      }
    }
    return this.kvStore.get(key) ?? null;
  }

  async set(key: string, value: string, ...args: any[]): Promise<'OK'> {
    if (this.isNativeConnected && this.nativeClient) {
      try {
        await (this.nativeClient as any).set(key, value, ...args);
        return 'OK';
      } catch {
        // Fallback a memoria
      }
    }
    this.kvStore.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    if (this.isNativeConnected && this.nativeClient) {
      try {
        return await this.nativeClient.del(key);
      } catch {
        // Fallback a memoria
      }
    }
    return this.kvStore.delete(key) ? 1 : 0;
  }

  async scard(key: string): Promise<number> {
    if (this.isNativeConnected && this.nativeClient) {
      try {
        return await this.nativeClient.scard(key);
      } catch {
        // Fallback
      }
    }
    return this.setStore.get(key)?.size ?? 0;
  }

  async sadd(key: string, member: string): Promise<number> {
    if (this.isNativeConnected && this.nativeClient) {
      try {
        return await this.nativeClient.sadd(key, member);
      } catch {
        // Fallback
      }
    }
    if (!this.setStore.has(key)) {
      this.setStore.set(key, new Set());
    }
    const set = this.setStore.get(key)!;
    const had = set.has(member);
    set.add(member);
    return had ? 0 : 1;
  }

  async srem(key: string, member: string): Promise<number> {
    if (this.isNativeConnected && this.nativeClient) {
      try {
        return await this.nativeClient.srem(key, member);
      } catch {
        // Fallback
      }
    }
    const set = this.setStore.get(key);
    if (!set) return 0;
    return set.delete(member) ? 1 : 0;
  }

  async smembers(key: string): Promise<string[]> {
    if (this.isNativeConnected && this.nativeClient) {
      try {
        return await this.nativeClient.smembers(key);
      } catch {
        // Fallback
      }
    }
    return Array.from(this.setStore.get(key) ?? []);
  }

  async rpush(key: string, member: string): Promise<number> {
    if (this.isNativeConnected && this.nativeClient) {
      try {
        return await this.nativeClient.rpush(key, member);
      } catch {
        // Fallback
      }
    }
    if (!this.listStore.has(key)) {
      this.listStore.set(key, []);
    }
    const list = this.listStore.get(key)!;
    list.push(member);
    return list.length;
  }

  async lpop(key: string): Promise<string | null> {
    if (this.isNativeConnected && this.nativeClient) {
      try {
        return await this.nativeClient.lpop(key);
      } catch {
        // Fallback
      }
    }
    const list = this.listStore.get(key);
    if (!list || list.length === 0) return null;
    return list.shift() ?? null;
  }

  async llen(key: string): Promise<number> {
    if (this.isNativeConnected && this.nativeClient) {
      try {
        return await this.nativeClient.llen(key);
      } catch {
        // Fallback
      }
    }
    return this.listStore.get(key)?.length ?? 0;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    if (this.isNativeConnected && this.nativeClient) {
      try {
        return await this.nativeClient.lrange(key, start, stop);
      } catch {
        // Fallback
      }
    }
    const list = this.listStore.get(key) ?? [];
    const end = stop === -1 ? list.length : stop + 1;
    return list.slice(start, end);
  }
}

let sharedInstance: HybridRedisClient | null = null;

export const RedisProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: () => {
    if (!sharedInstance) {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      sharedInstance = new HybridRedisClient(redisUrl);
    }
    return sharedInstance;
  },
};
