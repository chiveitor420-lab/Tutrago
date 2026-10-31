import { Controller, Post, Patch, Get, Body, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PickupService } from './pickup.service';
import {
  ActivatePickupInput,
  TicketStatus,
  UserRole,
  JwtAuthPayload,
} from '@tutrago/shared-types';
import { Roles, CurrentUser } from '../../common/decorators/roles.decorator';

@Controller('pickup')
export class PickupController {
  constructor(private readonly pickupService: PickupService) {}

  @Post('request')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Roles(UserRole.CONSUMER, UserRole.VENUE_ADMIN, UserRole.INCUBATIO_ADMIN)
  async requestPickup(
    @Body() body: ActivatePickupInput,
    @CurrentUser() user?: JwtAuthPayload
  ) {
    return this.pickupService.requestPickup(body, user);
  }

  @Patch('ticket/:ticketId/status')
  @Roles(
    UserRole.BAR_OPERATOR,
    UserRole.VENUE_ADMIN,
    UserRole.INCUBATIO_ADMIN,
    UserRole.CONSUMER
  )
  async advanceStatus(
    @Param('ticketId') ticketId: string,
    @Body('status') status: TicketStatus,
    @CurrentUser() user?: JwtAuthPayload
  ) {
    return this.pickupService.advanceTicketStatus(ticketId, status, user);
  }

  @Post('validate-scan')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Roles(UserRole.BAR_OPERATOR, UserRole.VENUE_ADMIN, UserRole.INCUBATIO_ADMIN)
  async validateScan(
    @Body('token') token: string,
    @Body('barId') barId?: string,
    @CurrentUser() user?: JwtAuthPayload
  ) {
    const effectiveBarId = barId || user?.assignedBarId;
    return this.pickupService.validateAndDeliverTicket(token, effectiveBarId);
  }

  @Post('service-recovery')
  @Roles(UserRole.BAR_OPERATOR, UserRole.VENUE_ADMIN, UserRole.INCUBATIO_ADMIN)
  async executeServiceRecovery(
    @Body()
    body: {
      action: 'SUBSTITUTE' | 'REFUND';
      ticketId?: string;
      productId: string;
      substituteProductId?: string;
      barId?: string;
    }
  ) {
    return this.pickupService.executeOneClickServiceRecovery(body);
  }

  @Post('bar/:barId/simulate')
  @Roles(UserRole.BAR_OPERATOR, UserRole.VENUE_ADMIN, UserRole.INCUBATIO_ADMIN)
  async simulateTicket(
    @Param('barId') barId: string,
    @Body() body?: { count?: number; includeSoldOut?: boolean }
  ) {
    return this.pickupService.simulateIncomingTickets(
      barId,
      body?.count || 1,
      Boolean(body?.includeSoldOut)
    );
  }

  @Get('bar/:barId/active')
  @Roles(UserRole.BAR_OPERATOR, UserRole.VENUE_ADMIN, UserRole.INCUBATIO_ADMIN)
  async getBarTickets(@Param('barId') barId: string) {
    return this.pickupService.getTicketsByBar(barId);
  }

  @Get('bar/:barId/queue')
  @Roles(
    UserRole.BAR_OPERATOR,
    UserRole.VENUE_ADMIN,
    UserRole.INCUBATIO_ADMIN,
    UserRole.CONSUMER
  )
  async getBarQueueStatus(@Param('barId') barId: string) {
    return this.pickupService.getBarQueueStatus(barId);
  }

  @Get('ticket/:ticketId')
  @Roles(
    UserRole.CONSUMER,
    UserRole.BAR_OPERATOR,
    UserRole.VENUE_ADMIN,
    UserRole.INCUBATIO_ADMIN
  )
  async getTicket(@Param('ticketId') ticketId: string) {
    return this.pickupService.getTicketById(ticketId);
  }
}
