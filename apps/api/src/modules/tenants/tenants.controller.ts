import { Controller, Get, Param } from '@nestjs/common';
import { TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get('slug/:slug')
  async getBySlug(@Param('slug') slug: string) {
    return this.tenantsService.getTenantBySlug(slug);
  }

  @Get(':tenantId/bars')
  async getBars(@Param('tenantId') tenantId: string) {
    return this.tenantsService.getBarsByTenant(tenantId);
  }

  @Get('bars/:barId')
  async getBar(@Param('barId') barId: string) {
    return this.tenantsService.getBarById(barId);
  }
}
