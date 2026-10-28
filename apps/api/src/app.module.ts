import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from './modules/database/database.module';
import { GatewayModule } from './modules/gateway/gateway.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PickupModule } from './modules/pickup/pickup.module';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { RedisProvider } from './config/redis.provider';

@Module({
  imports: [
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
    {
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyInterceptor,
    },
  ],
})
export class AppModule {}
