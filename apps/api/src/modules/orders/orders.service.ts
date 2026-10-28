import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { OrderStatus, CreateOrderInput } from '@tutrago/shared-types';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea una orden de compra en estado CREATED previa al pago.
   */
  async createOrder(dto: CreateOrderInput) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: dto.tenantId },
    });
    if (!tenant) {
      throw new NotFoundException(`Boliche con ID ${dto.tenantId} no encontrado.`);
    }

    // Asegurarse de que el usuario exista
    let user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          id: dto.userId,
          email: `${dto.userId}@guest.tutrago.com`,
          fullName: 'Invitado Boliche',
        },
      });
    }

    // Calcular montos a partir de los productos en base de datos
    let totalAmount = 0;
    const orderItemsData = [];

    for (const item of dto.items) {
      const product = await this.prisma.product.findUnique({
        where: { id: item.productId },
        include: { upsells: true },
      });

      if (!product) {
        throw new NotFoundException(`Producto ${item.productId} no encontrado.`);
      }

      if (!product.isAvailable) {
        throw new BadRequestException(`El producto "${product.name}" se encuentra agotado.`);
      }

      let unitPrice = product.price;

      if (item.selectedUpsellId) {
        const upsell = product.upsells.find((u) => u.id === item.selectedUpsellId);
        if (upsell) {
          unitPrice += upsell.additionalPrice;
        }
      }

      totalAmount += unitPrice * item.quantity;
      orderItemsData.push({
        productId: product.id,
        unitPrice,
        quantityPurchased: item.quantity,
        quantityRemaining: 0, // Se habilitará tras aprobación en el Webhook
        selectedUpsellId: item.selectedUpsellId,
      });
    }

    const platformFee = Math.round(totalAmount * ((tenant.commissionPct || 10.0) / 100.0) * 100) / 100;

    return this.prisma.order.create({
      data: {
        userId: user.id,
        tenantId: tenant.id,
        totalAmount,
        platformFee,
        paymentStatus: OrderStatus.CREATED,
        items: {
          create: orderItemsData,
        },
      },
      include: {
        items: {
          include: { product: true },
        },
      },
    });
  }

  /**
   * Obtiene la billetera de bebidas pagadas en espera (PAID_ON_HOLD con quantity_remaining > 0)
   */
  async getUserWallet(userId: string) {
    const activeItems = await this.prisma.orderItem.findMany({
      where: {
        order: {
          userId,
          paymentStatus: OrderStatus.PAID_ON_HOLD,
        },
        quantityRemaining: { gt: 0 },
      },
      include: {
        product: {
          include: {
            tenant: {
              select: { id: true, name: true },
            },
          },
        },
        order: {
          select: {
            id: true,
            createdAt: true,
            tenantId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return activeItems.map((item) => ({
      orderItemId: item.id,
      orderId: item.orderId,
      tenantId: item.product.tenantId,
      tenantName: item.product.tenant.name,
      productId: item.productId,
      productName: item.product.name,
      category: item.product.category,
      imageUrl: item.product.imageUrl,
      isAvailable: item.product.isAvailable,
      unitPrice: item.unitPrice,
      quantityRemaining: item.quantityRemaining,
      purchasedAt: item.order.createdAt,
    }));
  }

  async getOrderById(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: { product: true },
        },
        tenant: true,
      },
    });
    if (!order) throw new NotFoundException(`Orden ${orderId} no encontrada.`);
    return order;
  }
}
