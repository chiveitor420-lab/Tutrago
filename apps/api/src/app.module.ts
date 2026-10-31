import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { DatabaseModule } from './modules/database/database.module';
import { GatewayModule } from './modules/gateway/gateway.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PickupModule } from './modules/pickup/pickup.module';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { RedisProvider, REDIS_CLIENT } from './config/redis.provider';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler.storage';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [{ token: REDIS_CLIENT, optional: true }],
      useFactory: (redisClient?: any) => ({
        throttlers: [
          {
            name: 'default',
            ttl: 60000,
            limit: 60,
          },
        ],
        storage: new RedisThrottlerStorage(redisClient),
      }),
    }),
    DatabaseModule,
    GatewayModule,
    TenantsModule,
    CatalogModule,
    OrdersModule,
    PaymentsModule,
    PickupModule,
  ],
  providers: [
    RedisProvider,
    RedisThrottlerStorage,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyInterceptor,
    },
  ],
})
export class AppModule {}
