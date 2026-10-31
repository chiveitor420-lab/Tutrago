import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { UserRole } from '@tutrago/shared-types';
import { Public, Roles } from '../../common/decorators/roles.decorator';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('tenant/:tenantId')
  @Public()
  async getCatalog(@Param('tenantId') tenantId: string) {
    return this.catalogService.getCatalogByTenant(tenantId);
  }

  @Get(':tenantId')
  @Public()
  async getCatalogDirect(@Param('tenantId') tenantId: string) {
    return this.catalogService.getCatalogByTenant(tenantId);
  }

  @Post('tenant/:tenantId/product')
  @Roles(UserRole.VENUE_ADMIN, UserRole.INCUBATIO_ADMIN)
  async createProduct(
    @Param('tenantId') tenantId: string,
    @Body()
    body: {
      name: string;
      description?: string;
      price: number;
      category: string;
      imageUrl?: string;
      isAvailable?: boolean;
      sortOrder?: number;
      upsells?: Array<{
        title: string;
        additionalPrice: number;
        description?: string;
      }>;
    }
  ) {
    return this.catalogService.createProduct(tenantId, body);
  }

  @Patch('product/:productId')
  @Roles(UserRole.VENUE_ADMIN, UserRole.INCUBATIO_ADMIN)
  async updateProduct(
    @Param('productId') productId: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      price?: number;
      category?: string;
      imageUrl?: string;
      isAvailable?: boolean;
      sortOrder?: number;
      upsells?: Array<{
        title: string;
        additionalPrice: number;
        description?: string;
      }>;
    }
  ) {
    return this.catalogService.updateProduct(productId, body);
  }

  @Delete('product/:productId')
  @Roles(UserRole.VENUE_ADMIN, UserRole.INCUBATIO_ADMIN)
  async deleteProduct(@Param('productId') productId: string) {
    return this.catalogService.deleteProduct(productId);
  }

  @Patch('product/:productId/stock')
  @Roles(UserRole.BAR_OPERATOR, UserRole.VENUE_ADMIN, UserRole.INCUBATIO_ADMIN)
  async toggleStock(
    @Param('productId') productId: string,
    @Body('isAvailable') isAvailable: boolean
  ) {
    return this.catalogService.toggleProductAvailability(productId, isAvailable);
  }

  @Get('product/:productId/recovery')
  @Public()
  async getServiceRecovery(@Param('productId') productId: string) {
    return this.catalogService.getServiceRecoveryOptions(productId);
  }
}
