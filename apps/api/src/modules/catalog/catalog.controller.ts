import { Controller, Get, Patch, Param, Body } from '@nestjs/common';
import { CatalogService } from './catalog.service';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('tenant/:tenantId')
  async getCatalog(@Param('tenantId') tenantId: string) {
    return this.catalogService.getCatalogByTenant(tenantId);
  }

  @Patch('product/:productId/stock')
  async toggleStock(
    @Param('productId') productId: string,
    @Body('isAvailable') isAvailable: boolean
  ) {
    return this.catalogService.toggleProductAvailability(productId, isAvailable);
  }

  @Get('product/:productId/recovery')
  async getServiceRecovery(@Param('productId') productId: string) {
    return this.catalogService.getServiceRecoveryOptions(productId);
  }
}
