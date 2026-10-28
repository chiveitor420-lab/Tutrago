import { Provider } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export const RedisProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: () => {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    try {
      const client = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        retryStrategy(times) {
          if (times > 2) return null; // No bloquear si Redis local no está corriendo
          return 500;
        },
      });

      client.connect().catch((err) => {
        console.warn(`[RedisProvider] No se pudo conectar a Redis en ${redisUrl}. Operando con adaptador de contingencia.`);
      });

      return client;
    } catch (e) {
      console.warn('[RedisProvider] Error inicializando cliente Redis:', e);
      return null;
    }
  },
};
