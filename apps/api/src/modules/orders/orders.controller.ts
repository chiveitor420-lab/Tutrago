import { Controller, Post, Get, Param, Body, ForbiddenException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OrdersService } from './orders.service';
import { CreateOrderInput, UserRole, JwtAuthPayload } from '@tutrago/shared-types';
import { Roles, CurrentUser } from '../../common/decorators/roles.decorator';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Roles(UserRole.CONSUMER, UserRole.VENUE_ADMIN, UserRole.INCUBATIO_ADMIN)
  async createOrder(
    @Body() body: CreateOrderInput,
    @CurrentUser() user?: JwtAuthPayload
  ) {
    if (user?.role === UserRole.CONSUMER && user.sub && body.userId && body.userId !== user.sub) {
      throw new ForbiddenException('Un CONSUMER solo puede crear órdenes para su propia cuenta.');
    }
    return this.ordersService.createOrder(body);
  }

  @Get(':orderId')
  @Roles(UserRole.CONSUMER, UserRole.VENUE_ADMIN, UserRole.INCUBATIO_ADMIN)
  async getOrder(
    @Param('orderId') orderId: string,
    @CurrentUser() user?: JwtAuthPayload
  ) {
    const order = await this.ordersService.getOrderById(orderId);
    if (user?.role === UserRole.CONSUMER && user.sub && order.userId !== user.sub) {
      throw new ForbiddenException('No tienes permiso para ver órdenes de otro usuario.');
    }
    return order;
  }

  @Get('user/:userId/wallet')
  @Roles(UserRole.CONSUMER, UserRole.VENUE_ADMIN, UserRole.INCUBATIO_ADMIN)
  async getUserWallet(
    @Param('userId') userId: string,
    @CurrentUser() user?: JwtAuthPayload
  ) {
    if (user?.role === UserRole.CONSUMER && user.sub && userId !== user.sub) {
      throw new ForbiddenException('No tienes permiso para consultar la billetera de otro usuario.');
    }
    return this.ordersService.getUserWallet(userId);
  }
}
