import { Controller, Get, Post, Body, Headers, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PaymentsService } from './payments.service';
import {
  ProcessCardPaymentInput,
  PilotSimulationActionInput,
  JwtAuthPayload,
  UserRole,
} from '@tutrago/shared-types';
import { CurrentUser, Public, Roles } from '../../common/decorators/roles.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Public()
  @Get('sandbox-config')
  getSandboxConfig() {
    return this.paymentsService.getSandboxConfig();
  }

  @Roles(UserRole.CONSUMER, UserRole.VENUE_ADMIN, UserRole.INCUBATIO_ADMIN)
  @Post('preference/:orderId')
  async createPreference(@Param('orderId') orderId: string) {
    return this.paymentsService.createPaymentPreference(orderId);
  }

  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Roles(UserRole.CONSUMER, UserRole.VENUE_ADMIN, UserRole.INCUBATIO_ADMIN)
  @Post('process-card')
  async processCardPayment(@Body() body: ProcessCardPaymentInput) {
    return this.paymentsService.processCardPayment(body);
  }

  @Public()
  @Post('webhook')
  async handleWebhook(
    @Body() body: any,
    @Headers('x-signature') signature?: string,
    @Headers('x-request-id') requestId?: string
  ) {
    return this.paymentsService.processPaymentWebhook(body, signature, requestId);
  }

  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Post('pilot/simulate')
  async simulatePilotAction(
    @Body() body: PilotSimulationActionInput,
    @Headers('x-pilot-pin') pilotPinHeader?: string,
    @CurrentUser() user?: JwtAuthPayload
  ) {
    return this.paymentsService.simulatePilotAction(body, {
      pilotPinHeader,
      user,
    });
  }

  @Roles(UserRole.VENUE_ADMIN, UserRole.INCUBATIO_ADMIN)
  @Post('refund/:orderId')
  async refundOrder(@Param('orderId') orderId: string) {
    return this.paymentsService.executeAtomicOrderRefund(orderId);
  }

  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Post('simulate-approve/:orderId')
  async simulateApprove(
    @Param('orderId') orderId: string,
    @Headers('x-pilot-pin') pilotPin?: string,
    @Body() body?: { pilotPin?: string },
    @CurrentUser() user?: JwtAuthPayload
  ) {
    return this.paymentsService.simulatePaymentApproval(orderId, {
      user,
      pilotPin: pilotPin || body?.pilotPin,
    });
  }
}
