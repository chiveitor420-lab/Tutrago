import { Controller, Get, Post, Patch, Delete, Param, Body, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { TenantsService } from './tenants.service';
import { UpdateTenantFinancialConfigInput, UserRole } from '@tutrago/shared-types';
import { Public, Roles } from '../../common/decorators/roles.decorator';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('auth/login')
  async loginStaff(
    @Body()
    body: {
      email?: string;
      pin?: string;
      role?: 'OWNER' | 'INCUBATIO_ADMIN' | 'BARTENDER' | UserRole;
      barId?: string;
      tenantId?: string;
    }
  ) {
    return this.tenantsService.authenticateStaff(body);
  }

  @Public()
  @Throttle({ default: { limit: 25, ttl: 60000 } })
  @Post('auth/guest')
  async createGuestSession(
    @Body()
    body: {
      userId?: string;
      tenantId?: string;
      email?: string;
      name?: string;
    }
  ) {
    return this.tenantsService.createGuestSession(body);
  }

  @Public()
  @Get('slug/:slug')
  async getBySlug(@Param('slug') slug: string) {
    return this.tenantsService.getTenantBySlug(slug);
  }

  @Public()
  @Get(':tenantId')
  async getById(@Param('tenantId') tenantId: string) {
    return this.tenantsService.getTenantById(tenantId);
  }

  @Roles(UserRole.VENUE_ADMIN, UserRole.INCUBATIO_ADMIN)
  @Patch(':tenantId/financial-config')
  async updateFinancialConfig(
    @Param('tenantId') tenantId: string,
    @Body() body: UpdateTenantFinancialConfigInput
  ) {
    return this.tenantsService.updateFinancialConfig(tenantId, body);
  }

  @Public()
  @Get(':tenantId/bars')
  async getBars(
    @Param('tenantId') tenantId: string,
    @Query('includeAll') includeAll?: string
  ) {
    return this.tenantsService.getBarsByTenant(tenantId, includeAll === 'true');
  }

  @Public()
  @Get('bars/:barId')
  async getBar(@Param('barId') barId: string) {
    return this.tenantsService.getBarById(barId);
  }

  @Roles(UserRole.VENUE_ADMIN, UserRole.INCUBATIO_ADMIN)
  @Post(':tenantId/bars')
  async createBar(
    @Param('tenantId') tenantId: string,
    @Body()
    body: {
      name: string;
      maxConcurrentPrep?: number;
      printerType?: string;
      printerIp?: string;
      status?: 'ACTIVE' | 'PAUSED' | 'CLOSED';
    }
  ) {
    return this.tenantsService.createBar(tenantId, body);
  }

  @Roles(UserRole.VENUE_ADMIN, UserRole.INCUBATIO_ADMIN)
  @Patch('bars/:barId')
  async updateBar(
    @Param('barId') barId: string,
    @Body()
    body: {
      name?: string;
      maxConcurrentPrep?: number;
      printerType?: string;
      printerIp?: string;
      status?: 'ACTIVE' | 'PAUSED' | 'CLOSED';
    }
  ) {
    return this.tenantsService.updateBar(barId, body);
  }

  @Roles(UserRole.VENUE_ADMIN, UserRole.INCUBATIO_ADMIN)
  @Delete('bars/:barId')
  async deleteBar(@Param('barId') barId: string) {
    return this.tenantsService.deleteBar(barId);
  }

  @Roles(UserRole.VENUE_ADMIN, UserRole.INCUBATIO_ADMIN)
  @Get(':tenantId/metrics')
  async getLiveMetrics(@Param('tenantId') tenantId: string) {
    return this.tenantsService.getLiveNightMetrics(tenantId);
  }
}
