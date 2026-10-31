import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { RedisProvider } from '../../config/redis.provider';

@Module({
  controllers: [TenantsController],
  providers: [TenantsService, RedisProvider],
  exports: [TenantsService],
})
export class TenantsModule {}
