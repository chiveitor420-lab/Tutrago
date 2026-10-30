import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EventsGateway } from '../gateway/events.gateway';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsGateway: EventsGateway
  ) {}

  async getCatalogByTenant(tenantId: string) {
    return this.prisma.product.findMany({
      where: { tenantId },
      include: {
        upsells: true,
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async toggleProductAvailability(productId: string, isAvailable: boolean) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException(`Producto con ID ${productId} no encontrado.`);
    }

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: { isAvailable },
      include: { upsells: true },
    });

    this.eventsGateway.emitStockToggle({
      productId: updated.id,
      tenantId: updated.tenantId,
      isAvailable: updated.isAvailable,
    });

    return updated;
  }

  async getServiceRecoveryOptions(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException(`Producto con ID ${productId} no encontrado.`);
    }

    // Buscar sustitutos disponibles en la misma categoría con precio similar
    const substitutes = await this.prisma.product.findMany({
      where: {
        tenantId: product.tenantId,
        category: product.category,
        isAvailable: true,
        id: { not: productId },
      },
      take: 4,
    });

    return {
      originalProduct: product,
      refundableAmount: product.price,
      suggestedSubstitutes: substitutes,
    };
  }
}
