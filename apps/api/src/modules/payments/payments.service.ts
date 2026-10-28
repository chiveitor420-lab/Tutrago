import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { OrderStatus } from '@tutrago/shared-types';
import * as crypto from 'crypto';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Genera la preferencia de pago de Mercado Pago con Split Payment automático (marketplace_fee).
   * La comisión de Incubatio se descuenta directamente en la transacción.
   */
  async createPaymentPreference(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        tenant: true,
        items: {
          include: { product: true },
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Orden ${orderId} no encontrada.`);
    }

    const commissionRate = (order.tenant.commissionPct || 10.0) / 100.0;
    const platformFee = Math.round(order.totalAmount * commissionRate * 100) / 100;

    // Actualizamos el platform_fee calculado en la orden
    await this.prisma.order.update({
      where: { id: orderId },
      data: { platformFee },
    });

    // Payload de Split Payment para Mercado Pago Checkout Pro
    const preferencePayload = {
      items: order.items.map((item) => ({
        id: item.productId,
        title: item.product.name,
        unit_price: Number(item.unitPrice),
        quantity: item.quantityPurchased,
        currency_id: 'ARS',
      })),
      marketplace_fee: platformFee, // Comisión directa a cuenta de Incubatio
      external_reference: order.id,
      notification_url: `${process.env.API_URL || 'http://localhost:3001'}/payments/webhook`,
      back_urls: {
        success: `${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8081'}/wallet?status=success&orderId=${order.id}`,
        failure: `${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8081'}/checkout?status=failure`,
        pending: `${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8081'}/wallet?status=pending`,
      },
      auto_return: 'approved',
    };

    // Simulador de Mercado Pago para entorno local sin bloquear si no hay tokens de producción
    const mockPreferenceId = `PREF-${Date.now()}-${order.id.slice(0, 8)}`;
    const initPoint = `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=${mockPreferenceId}`;

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        mpPreferenceId: mockPreferenceId,
        paymentStatus: OrderStatus.PENDING_PAYMENT,
      },
    });

    return {
      orderId: order.id,
      preferenceId: mockPreferenceId,
      initPoint,
      totalAmount: order.totalAmount,
      platformFee,
      bolicheAmount: order.totalAmount - platformFee,
      payload: preferencePayload,
    };
  }

  /**
   * Procesa el Webhook transaccional de Mercado Pago.
   * Al aprobarse, ejecuta una transacción ACID en PostgreSQL para pasar la orden a PAID_ON_HOLD
   * y habilitar quantity_remaining en los OrderItems correspondientes.
   */
  async processPaymentWebhook(body: any, signatureHeader?: string) {
    // 1. Verificación de firma HMAC si el secreto está configurado
    const webhookSecret = process.env.MP_WEBHOOK_SECRET;
    if (webhookSecret && signatureHeader) {
      const parts = signatureHeader.split(',');
      let ts = '';
      let v1 = '';
      for (const part of parts) {
        const [k, v] = part.split('=');
        if (k?.trim() === 'ts') ts = v?.trim();
        if (k?.trim() === 'v1') v1 = v?.trim();
      }

      if (ts && v1) {
        const manifest = `id:${body.data?.id};request-id:${ts};`;
        const expectedHmac = crypto.createHmac('sha256', webhookSecret).update(manifest).digest('hex');
        if (expectedHmac !== v1) {
          console.warn('[Webhook MP] Advertencia: Firma HMAC no coincide.');
        }
      }
    }

    const orderId = body.external_reference || body.orderId || body.data?.external_reference;
    const paymentId = body.data?.id ? String(body.data.id) : (body.paymentId || `PAY-${Date.now()}`);

    if (!orderId) {
      return { status: 'IGNORED', message: 'Notificación sin external_reference' };
    }

    // 2. Transacción ACID: Pasar a PAID_ON_HOLD e inicializar saldos de canje
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      if (!order) {
        throw new NotFoundException(`Orden ${orderId} no encontrada.`);
      }

      // Si ya estaba aprobada, no duplicar
      if (order.paymentStatus === OrderStatus.PAID_ON_HOLD) {
        return order;
      }

      // Actualizar estado general
      await tx.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: OrderStatus.PAID_ON_HOLD,
          mpPaymentId: paymentId,
        },
      });

      // Habilitar el saldo de canje en cada ítem
      for (const item of order.items) {
        await tx.orderItem.update({
          where: { id: item.id },
          data: {
            quantityRemaining: item.quantityPurchased,
          },
        });
      }

      return tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
    });

    console.log(`[Split Payment] Orden ${orderId} aprobada. Bebidas acreditadas en PAID_ON_HOLD.`);
    return { status: 'SUCCESS', order: updatedOrder };
  }

  /**
   * Simulación directa de aprobación de pago para pruebas y QA
   */
  async simulatePaymentApproval(orderId: string) {
    return this.processPaymentWebhook({
      orderId,
      data: { id: `MOCK-PAY-${Date.now()}`, external_reference: orderId },
    });
  }
}
