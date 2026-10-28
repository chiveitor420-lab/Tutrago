import { Controller, Post, Body, Headers, Param } from '@nestjs/common';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('preference/:orderId')
  async createPreference(@Param('orderId') orderId: string) {
    return this.paymentsService.createPaymentPreference(orderId);
  }

  @Post('webhook')
  async handleWebhook(
    @Body() body: any,
    @Headers('x-signature') signature?: string
  ) {
    return this.paymentsService.processPaymentWebhook(body, signature);
  }

  @Post('simulate-approve/:orderId')
  async simulateApprove(@Param('orderId') orderId: string) {
    return this.paymentsService.simulatePaymentApproval(orderId);
  }
}
