import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
  ConflictException,
  Inject,
  Optional,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import type Redis from 'ioredis';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Optional() @Inject('REDIS_CLIENT') private readonly redisClient?: Redis
  ) {}

  // Memoria local como fallback ultra-resistente en caso de que Redis no esté disponible
  private static localCache = new Map<
    string,
    { status: 'PENDING' | 'COMPLETED'; response?: any; timestamp: number }
  >();

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest();
    const response = httpContext.getResponse();
    const method = request.method?.toUpperCase();

    // Solo protegemos endpoints mutables
    if (method !== 'POST' && method !== 'PATCH') {
      return next.handle();
    }

    // Excluir endpoints públicos de autenticación y webhooks externos (que usan su propia firma HMAC)
    const path: string = request.url || '';
    if (path.startsWith('/tenants/auth') || path.startsWith('/payments/webhook')) {
      return next.handle();
    }

    const idempotencyKey = request.headers['x-idempotency-key'] as string;
    if (!idempotencyKey) {
      throw new BadRequestException(
        'El encabezado X-Idempotency-Key es obligatorio para peticiones mutables.'
      );
    }

    const redisKey = `idemp:${idempotencyKey}`;

    // 1. Verificar si la clave ya existe y adquirir lock atómico (SET ... EX 60 NX)
    if (this.redisClient) {
      const existing = await this.redisClient.get(redisKey);
      if (existing) {
        const parsed = JSON.parse(existing);
        if (parsed.status === 'PENDING') {
          throw new ConflictException(
            'Petición en curso con la misma clave de idempotencia (409 Conflict).'
          );
        }
        if (parsed.status === 'COMPLETED') {
          response.header('X-Cache-Lookup', 'HIT-IDEMPOTENCY');
          return of(parsed.data);
        }
      }

      // Bloqueo atómico en Redis con NX y TTL de 60 segundos para evitar condiciones de carrera (TOCTOU)
      const acquired = await (this.redisClient as any).set(
        redisKey,
        JSON.stringify({ status: 'PENDING', timestamp: Date.now() }),
        'EX',
        60,
        'NX'
      );

      if (acquired === null) {
        const concurrentState = await this.redisClient.get(redisKey);
        if (concurrentState) {
          const parsed = JSON.parse(concurrentState);
          if (parsed.status === 'COMPLETED') {
            response.header('X-Cache-Lookup', 'HIT-IDEMPOTENCY');
            return of(parsed.data);
          }
        }
        throw new ConflictException(
          'Petición concurrente bloqueada con la misma clave de idempotencia (409 Conflict).'
        );
      }
    } else {
      // Fallback atómico en memoria local
      const entry = IdempotencyInterceptor.localCache.get(redisKey);
      if (entry) {
        if (entry.status === 'PENDING') {
          throw new ConflictException(
            'Petición en curso con la misma clave de idempotencia (409 Conflict).'
          );
        }
        if (entry.status === 'COMPLETED') {
          response.header('X-Cache-Lookup', 'HIT-IDEMPOTENCY');
          return of(entry.response);
        }
      }
      IdempotencyInterceptor.localCache.set(redisKey, {
        status: 'PENDING',
        timestamp: Date.now(),
      });
    }

    // 2. Procesar la petición y cachear el resultado al finalizar
    return next.handle().pipe(
      tap(async (data) => {
        if (this.redisClient) {
          await (this.redisClient as any).set(
            redisKey,
            JSON.stringify({ status: 'COMPLETED', data }),
            'EX',
            86400
          );
        } else {
          IdempotencyInterceptor.localCache.set(redisKey, {
            status: 'COMPLETED',
            response: data,
            timestamp: Date.now(),
          });
        }
      }),
      catchError(async (err) => {
        if (this.redisClient) {
          await this.redisClient.del(redisKey);
        } else {
          IdempotencyInterceptor.localCache.delete(redisKey);
        }
        throw err;
      })
    );
  }
}
