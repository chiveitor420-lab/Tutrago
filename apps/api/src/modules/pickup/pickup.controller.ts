import { Controller, Post, Patch, Get, Body, Param } from '@nestjs/common';
import { PickupService } from './pickup.service';
import { ActivatePickupInput, TicketStatus } from '@tutrago/shared-types';

@Controller('pickup')
export class PickupController {
  constructor(private readonly pickupService: PickupService) {}

  @Post('request')
  async requestPickup(@Body() body: ActivatePickupInput) {
    return this.pickupService.requestPickup(body);
  }

  @Patch('ticket/:ticketId/status')
  async advanceStatus(
    @Param('ticketId') ticketId: string,
    @Body('status') status: TicketStatus
  ) {
    return this.pickupService.advanceTicketStatus(ticketId, status);
  }

  @Post('validate-scan')
  async validateScan(@Body('token') token: string) {
    return this.pickupService.validateAndDeliverTicket(token);
  }

  @Get('bar/:barId/active')
  async getBarTickets(@Param('barId') barId: string) {
    return this.pickupService.getTicketsByBar(barId);
  }

  @Get('ticket/:ticketId')
  async getTicket(@Param('ticketId') ticketId: string) {
    return this.pickupService.getTicketById(ticketId);
  }
}
