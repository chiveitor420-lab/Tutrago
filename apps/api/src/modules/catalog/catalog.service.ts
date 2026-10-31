import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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

  async createProduct(
    tenantId: string,
    dto: {
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
    if (!dto.name || dto.price === undefined) {
      throw new BadRequestException('Nombre y precio del producto son obligatorios.');
    }

    const existingProducts = await this.prisma.product.findMany({
      where: { tenantId },
    });

    const created = await this.prisma.product.create({
      data: {
        tenantId,
        name: dto.name.trim(),
        description: dto.description || '',
        price: Number(dto.price),
        category: dto.category || 'Tragos Clásicos',
        imageUrl:
          dto.imageUrl ||
          'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=500',
        isAvailable: dto.isAvailable !== undefined ? Boolean(dto.isAvailable) : true,
        sortOrder: dto.sortOrder ?? existingProducts.length + 1,
        upsells: {
          create: (dto.upsells || []).map((u) => ({
            title: u.title.trim(),
            additionalPrice: Number(u.additionalPrice),
            description: u.description || '',
          })),
        },
      },
      include: {
        upsells: true,
      },
    });

    this.eventsGateway.emitCatalogUpdate(tenantId, {
      action: 'PRODUCT_CREATED',
      product: created,
    });

    return created;
  }

  async updateProduct(
    productId: string,
    dto: {
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
    const existing = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!existing) {
      throw new NotFoundException(`Producto con ID ${productId} no encontrado.`);
    }

    const updateData: any = {};
    if (dto.name !== undefined) updateData.name = dto.name.trim();
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.price !== undefined) updateData.price = Number(dto.price);
    if (dto.category !== undefined) updateData.category = dto.category;
    if (dto.imageUrl !== undefined) updateData.imageUrl = dto.imageUrl;
    if (dto.isAvailable !== undefined) updateData.isAvailable = Boolean(dto.isAvailable);
    if (dto.sortOrder !== undefined) updateData.sortOrder = Number(dto.sortOrder);

    if (dto.upsells !== undefined) {
      updateData.upsells = {
        deleteMany: {},
        create: dto.upsells.map((u) => ({
          title: u.title.trim(),
          additionalPrice: Number(u.additionalPrice),
          description: u.description || '',
        })),
      };
    }

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: updateData,
      include: { upsells: true },
    });

    this.eventsGateway.emitCatalogUpdate(updated.tenantId, {
      action: 'PRODUCT_UPDATED',
      product: updated,
    });

    return updated;
  }

  async deleteProduct(productId: string) {
    const existing = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!existing) {
      throw new NotFoundException(`Producto con ID ${productId} no encontrado.`);
    }

    await this.prisma.product.delete({ where: { id: productId } });

    this.eventsGateway.emitCatalogUpdate(existing.tenantId, {
      action: 'PRODUCT_DELETED',
      productId,
    });

    return { deleted: true, productId };
  }

  async toggleProductAvailability(productId: string, isAvailable: boolean) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException(`Producto con ID ${productId} no encontrado.`);
    }

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: { isAvailable: Boolean(isAvailable) },
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

    // Buscar sustitutos disponibles en la misma categoría o de precio equivalente/superior
    let substitutes = await this.prisma.product.findMany({
      where: {
        tenantId: product.tenantId,
        category: product.category,
        isAvailable: true,
        id: { not: productId },
      },
      take: 4,
    });

    if (substitutes.length < 3) {
      const others = await this.prisma.product.findMany({
        where: {
          tenantId: product.tenantId,
          isAvailable: true,
          id: { not: productId },
        },
      });
      const existingIds = new Set(substitutes.map((s) => s.id));
      for (const o of others) {
        if (!existingIds.has(o.id) && substitutes.length < 4) {
          substitutes.push(o);
        }
      }
    }

    return {
      originalProduct: product,
      refundableAmount: product.price,
      suggestedSubstitutes: substitutes,
    };
  }
}
