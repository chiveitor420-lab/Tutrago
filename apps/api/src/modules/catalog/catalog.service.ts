import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.product.update({
      where: { id: productId },
      data: { isAvailable },
      include: { upsells: true },
    });
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
