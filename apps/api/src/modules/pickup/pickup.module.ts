import { Module } from '@nestjs/common';
import { PickupService } from './pickup.service';
import { PickupController } from './pickup.controller';
import { RedisProvider } from '../../config/redis.provider';

@Module({
  controllers: [PickupController],
  providers: [PickupService, RedisProvider],
  exports: [PickupService],
})
export class PickupModule {}
