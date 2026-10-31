import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  OrderStatus,
  CreateOrderInput,
  calculateOrderFinancials,
  ItemFinancialInput,
} from '@tutrago/shared-types';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea una orden de compra en estado CREATED previa al pago.
   * Aplica aritmética decimal exacta en centavos (BigInt) configurable por Tenant.
   */
  async createOrder(dto: CreateOrderInput) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('La orden debe incluir al menos una bebida.');
    }

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

    // Validar productos y preparar insumos financieros exactos por bebida
    const financialInputs: ItemFinancialInput[] = [];

    for (const item of dto.items) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new BadRequestException(`Cantidad inválida para producto ${item.productId}.`);
      }

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

      let upsellPrice = 0;

      if (item.selectedUpsellId) {
        const upsell = product.upsells.find((u) => u.id === item.selectedUpsellId);
        if (!upsell) {
          throw new BadRequestException(
            `El upgrade seleccionado (${item.selectedUpsellId}) no pertenece al producto "${product.name}".`
          );
        }
        upsellPrice = upsell.additionalPrice;
      }

      financialInputs.push({
        productId: product.id,
        basePrice: product.price,
        upsellPrice,
        quantity: item.quantity,
        selectedUpsellId: item.selectedUpsellId,
      });
    }

    const commissionPct =
      tenant.commissionPct !== undefined && tenant.commissionPct !== null
        ? tenant.commissionPct
        : Number(process.env.INCUBATIO_COMMISSION_PCT ?? 10.0);

    const gatewayFeePct =
      (tenant as any).gatewayFeePct !== undefined && (tenant as any).gatewayFeePct !== null
        ? (tenant as any).gatewayFeePct
        : Number(process.env.MP_GATEWAY_FEE_PCT ?? 4.5);

    const breakdown = calculateOrderFinancials(financialInputs, commissionPct, gatewayFeePct);

    const orderItemsData = breakdown.items.map((item) => ({
      productId: item.productId,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal,
      itemPlatformFee: item.itemPlatformFee,
      itemGatewayFee: item.itemGatewayFee,
      itemTenantNet: item.itemTenantNet,
      quantityPurchased: item.quantityPurchased,
      quantityRemaining: 0, // Se habilitará atómicamente tras aprobación en el Webhook / Pasarela
      selectedUpsellId: item.selectedUpsellId,
    }));

    return this.prisma.order.create({
      data: {
        userId: user.id,
        tenantId: tenant.id,
        totalAmount: breakdown.totalAmount,
        platformFee: breakdown.platformFee,
        gatewayFee: breakdown.gatewayFee,
        tenantNetAmount: breakdown.tenantNetAmount,
        appliedCommissionPct: breakdown.appliedCommissionPct,
        appliedGatewayFeePct: breakdown.appliedGatewayFeePct,
        paymentStatus: OrderStatus.CREATED,
        items: {
          create: orderItemsData,
        },
      },
      include: {
        items: {
          include: { product: true },
        },
        tenant: true,
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
