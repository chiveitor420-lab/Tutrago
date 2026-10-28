import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderInput } from '@tutrago/shared-types';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  async createOrder(@Body() body: CreateOrderInput) {
    return this.ordersService.createOrder(body);
  }

  @Get(':orderId')
  async getOrder(@Param('orderId') orderId: string) {
    return this.ordersService.getOrderById(orderId);
  }

  @Get('user/:userId/wallet')
  async getUserWallet(@Param('userId') userId: string) {
    return this.ordersService.getUserWallet(userId);
  }
}
