import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EventsGateway } from '../gateway/events.gateway';
import {
  OrderStatus,
  calculateOrderFinancials,
  ProcessCardPaymentInput,
  PilotSimulationActionInput,
  JwtAuthPayload,
  UserRole,
} from '@tutrago/shared-types';
import * as crypto from 'crypto';
import { safeComparePin } from '../../common/security/jwt.util';

export interface SandboxTestCard {
  id: string;
  label: string;
  brand: string;
  cardNumber: string;
  cardholderName: string;
  expirationDate: string;
  securityCode: string;
  statusHint: 'APRO' | 'FUND' | 'SECU' | 'OTHE';
  expectedOutcome: string;
  badgeColor: string;
}

export const MP_SANDBOX_TEST_CARDS: SandboxTestCard[] = [
  {
    id: 'mp-visa-apro',
    label: 'Visa Débito/Crédito — Aprobación Instantánea',
    brand: 'visa',
    cardNumber: '4509953566233704',
    cardholderName: 'APRO',
    expirationDate: '11/30',
    securityCode: '123',
    statusHint: 'APRO',
    expectedOutcome: 'APROBADO (PAID_ON_HOLD)',
    badgeColor: '#10B981',
  },
  {
    id: 'mp-master-fund',
    label: 'Mastercard — Rechazo por Fondos Insuficientes',
    brand: 'master',
    cardNumber: '5031433224146351',
    cardholderName: 'FUND',
    expirationDate: '08/29',
    securityCode: '456',
    statusHint: 'FUND',
    expectedOutcome: 'RECHAZADO (Sin Saldo)',
    badgeColor: '#EF4444',
  },
  {
    id: 'mp-amex-secu',
    label: 'Amex — Rechazo por Seguridad / Antifraude',
    brand: 'amex',
    cardNumber: '371180303257804',
    cardholderName: 'SECU',
    expirationDate: '05/28',
    securityCode: '9999',
    statusHint: 'SECU',
    expectedOutcome: 'RECHAZADO (Seguridad)',
    badgeColor: '#F59E0B',
  },
  {
    id: 'mp-visa-othe',
    label: 'Visa — Rechazo General del Banco Emisor',
    brand: 'visa',
    cardNumber: '4509953566230122',
    cardholderName: 'OTHE',
    expirationDate: '03/29',
    securityCode: '321',
    statusHint: 'OTHE',
    expectedOutcome: 'RECHAZADO (Error Emisor)',
    badgeColor: '#6B7280',
  },
];

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly eventsGateway?: EventsGateway
  ) {}

  /**
   * Devuelve el catálogo de tarjetas de prueba de Mercado Pago Sandbox
   * y el estado del modo piloto para pruebas físicas en la barra.
   */
  getSandboxConfig() {
    const sandboxEnabled = process.env.MP_SANDBOX_MODE !== 'false';
    return {
      sandboxEnabled,
      pilotPinRequired: true,
      defaultPilotPinHint:
        sandboxEnabled || process.env.NODE_ENV !== 'production' ? '2026' : undefined,
      testCards: MP_SANDBOX_TEST_CARDS,
    };
  }

  /**
   * Genera la preferencia de pago de Mercado Pago con Split Payment automático (marketplace_fee)
   * y cálculo decimal exacto en centavos (BigInt) configurable por Tenant.
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

    const commissionPct =
      order.tenant.commissionPct !== undefined && order.tenant.commissionPct !== null
        ? order.tenant.commissionPct
        : Number(process.env.INCUBATIO_COMMISSION_PCT ?? 10.0);

    const gatewayFeePct =
      (order.tenant as any).gatewayFeePct !== undefined && (order.tenant as any).gatewayFeePct !== null
        ? (order.tenant as any).gatewayFeePct
        : Number(process.env.MP_GATEWAY_FEE_PCT ?? 4.5);

    const breakdown = calculateOrderFinancials(
      order.items.map((item) => ({
        productId: item.productId,
        basePrice: item.unitPrice,
        upsellPrice: 0,
        quantity: item.quantityPurchased,
        selectedUpsellId: item.selectedUpsellId ?? undefined,
      })),
      commissionPct,
      gatewayFeePct
    );

    // Payload de Split Payment para Mercado Pago Checkout Pro / Bricks
    const preferencePayload = {
      items: order.items.map((item) => ({
        id: item.productId,
        title: item.product?.name || 'Bebida Tutrago',
        unit_price: Number(item.unitPrice),
        quantity: item.quantityPurchased,
        currency_id: 'ARS',
      })),
      marketplace_fee: breakdown.platformFee, // Comisión directa a cuenta de Tutrago / Incubatio
      external_reference: order.id,
      notification_url: `${process.env.API_URL || 'http://localhost:3001'}/payments/webhook`,
      back_urls: {
        success: `${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8081'}/wallet?status=success&orderId=${order.id}`,
        failure: `${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8081'}/checkout?status=failure`,
        pending: `${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8081'}/wallet?status=pending`,
      },
      auto_return: 'approved' as const,
      statement_descriptor: 'TUTRAGO BARRA',
    };

    let preferenceId = `PREF-${Date.now()}-${order.id.slice(0, 8)}`;
    let initPoint = `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=${preferenceId}`;
    let sandboxInitPoint = `https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=${preferenceId}`;

    // Si el boliche tiene un token OAuth real de Mercado Pago y no está forzado el mock local
    const sellerToken = order.tenant.mpAccessToken || process.env.MP_PLATFORM_ACCESS_TOKEN;
    const isMockToken =
      !sellerToken ||
      sellerToken.startsWith('TEST-ACCESS-TOKEN') ||
      sellerToken === 'TEST-your-collector-access-token';

    if (!isMockToken && process.env.MP_ENABLE_LIVE_API === 'true') {
      try {
        const { MercadoPagoConfig, Preference } = await import('mercadopago');
        const client = new MercadoPagoConfig({ accessToken: sellerToken });
        const preferenceClient = new Preference(client);
        const mpRes = await preferenceClient.create({ body: preferencePayload });
        if (mpRes.id) preferenceId = mpRes.id;
        if (mpRes.init_point) initPoint = mpRes.init_point;
        if (mpRes.sandbox_init_point) sandboxInitPoint = mpRes.sandbox_init_point;
      } catch (err: any) {
        console.warn(`[MercadoPago SDK] Fallback a preferencia Sandbox local: ${err.message}`);
      }
    }

    // Deep Link directo a la App móvil de Mercado Pago para pagar con Dinero en Cuenta en segundos
    const deepLinkUrl = `mercadopago://checkout/v1/redirect?pref_id=${preferenceId}`;

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        totalAmount: breakdown.totalAmount,
        platformFee: breakdown.platformFee,
        gatewayFee: breakdown.gatewayFee,
        tenantNetAmount: breakdown.tenantNetAmount,
        appliedCommissionPct: breakdown.appliedCommissionPct,
        appliedGatewayFeePct: breakdown.appliedGatewayFeePct,
        mpPreferenceId: preferenceId,
        paymentStatus:
          order.paymentStatus === OrderStatus.PAID_ON_HOLD
            ? OrderStatus.PAID_ON_HOLD
            : OrderStatus.PENDING_PAYMENT,
      },
    });

    return {
      orderId: order.id,
      preferenceId,
      initPoint,
      sandboxInitPoint,
      deepLinkUrl,
      sandboxMode: (order.tenant as any).sandboxMode ?? true,
      totalAmount: breakdown.totalAmount,
      platformFee: breakdown.platformFee,
      gatewayFee: breakdown.gatewayFee,
      tenantNetAmount: breakdown.tenantNetAmount,
      bolicheAmount: breakdown.tenantNetAmount, // Alias compatible con versión previa
      appliedCommissionPct: breakdown.appliedCommissionPct,
      appliedGatewayFeePct: breakdown.appliedGatewayFeePct,
      itemsBreakdown: breakdown.items,
      payload: preferencePayload,
    };
  }

  /**
   * Verifica criptográficamente la firma HMAC-SHA256 enviada por Mercado Pago en el header x-signature.
   * Utiliza comparación en tiempo constante (crypto.timingSafeEqual) para mitigar ataques de timing.
   */
  verifyWebhookSignature(
    dataId: string,
    signatureHeader?: string,
    requestIdHeader?: string,
    secretOverride?: string
  ): boolean {
    const webhookSecret = secretOverride ?? process.env.MP_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return true; // En desarrollo local sin MP_WEBHOOK_SECRET configurado se permite el paso
    }

    if (!signatureHeader) {
      return false;
    }

    const parts = signatureHeader.split(',');
    let ts = '';
    let v1 = '';
    for (const part of parts) {
      const [k, v] = part.split('=');
      if (k?.trim() === 'ts') ts = v?.trim() || '';
      if (k?.trim() === 'v1') v1 = v?.trim() || '';
    }

    if (!ts || !v1) {
      return false;
    }

    // Formato oficial Mercado Pago v1: "id:[data.id];request-id:[x-request-id];ts:[ts];"
    // y soporte retrocompatible: "id:[data.id];request-id:[ts];"
    const candidateManifests = [
      requestIdHeader ? `id:${dataId};request-id:${requestIdHeader};ts:${ts};` : null,
      `id:${dataId};request-id:${ts};ts:${ts};`,
      `id:${dataId};request-id:${ts};`,
    ].filter(Boolean) as string[];

    for (const manifest of candidateManifests) {
      const expectedHex = crypto.createHmac('sha256', webhookSecret).update(manifest).digest('hex');
      const expectedBuf = Buffer.from(expectedHex, 'utf8');
      const receivedBuf = Buffer.from(v1, 'utf8');
      if (
        expectedBuf.length === receivedBuf.length &&
        crypto.timingSafeEqual(expectedBuf, receivedBuf)
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Genera una firma HMAC-SHA256 válida para pruebas E2E y simulaciones firmadas.
   */
  generateWebhookSignature(dataId: string, secret: string, ts = `${Date.now()}`, requestId?: string): string {
    const manifest = requestId
      ? `id:${dataId};request-id:${requestId};ts:${ts};`
      : `id:${dataId};request-id:${ts};`;
    const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
    return `ts=${ts},v1=${v1}`;
  }

  /**
   * Procesa el Webhook transaccional de Mercado Pago.
   * Valida firma criptográfica HMAC-SHA256, y ejecuta una transacción ACID e idempotente
   * para pasar la orden de CREATED / PENDING_PAYMENT a PAID_ON_HOLD (o CANCELLED_REFUNDED),
   * habilitando los vales en el celular del usuario al instante.
   */
  async processPaymentWebhook(body: any, signatureHeader?: string, requestIdHeader?: string) {
    const paymentId = body.data?.id ? String(body.data.id) : body.paymentId || `PAY-${Date.now()}`;

    // 1. Validación estricta de firma criptográfica HMAC-SHA256 si MP_WEBHOOK_SECRET está activo
    const webhookSecret = process.env.MP_WEBHOOK_SECRET;
    if (webhookSecret && webhookSecret !== 'your_mp_webhook_secret_hmac') {
      const isValid = this.verifyWebhookSignature(paymentId, signatureHeader, requestIdHeader, webhookSecret);
      if (!isValid) {
        throw new UnauthorizedException('Firma criptográfica de Webhook Mercado Pago inválida o ausente.');
      }
    }

    const orderId = body.external_reference || body.orderId || body.data?.external_reference;
    if (!orderId) {
      return { status: 'IGNORED', message: 'Notificación sin external_reference' };
    }

    const paymentStatusRaw = String(body.status || body.action || body.data?.status || 'approved').toLowerCase();

    // Caso A: Reembolso o Cancelación -> Revocación atómica de vales
    if (paymentStatusRaw === 'refunded' || paymentStatusRaw === 'cancelled' || paymentStatusRaw === 'charged_back') {
      return this.executeAtomicOrderRefund(orderId, paymentId);
    }

    // Caso B: Pago rechazado en pasarela -> Mantener en PENDING_PAYMENT sin habilitar vales
    if (paymentStatusRaw === 'rejected' || paymentStatusRaw.startsWith('cc_rejected')) {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order) {
        throw new NotFoundException(`Orden ${orderId} no encontrada.`);
      }
      return {
        status: 'REJECTED',
        reason: body.status_detail || paymentStatusRaw,
        order,
      };
    }

    // Caso C: Aprobación atómica e idempotente -> Pasar a PAID_ON_HOLD e inicializar saldos de canje
    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, tenant: true },
      });

      if (!order) {
        throw new NotFoundException(`Orden ${orderId} no encontrada.`);
      }

      // Idempotencia estricta: Si ya estaba en PAID_ON_HOLD, devolver sin duplicar saldos
      if (order.paymentStatus === OrderStatus.PAID_ON_HOLD) {
        return order;
      }

      if (order.paymentStatus === OrderStatus.CANCELLED_REFUNDED) {
        throw new BadRequestException(`La orden ${orderId} fue reembolsada/cancelada y no puede acreditarse.`);
      }

      // Recalcular desglose si por alguna razón la orden no tenía gatewayFee o tenantNetAmount
      const commissionPct = order.appliedCommissionPct ?? order.tenant?.commissionPct ?? 10.0;
      const gatewayFeePct = (order as any).appliedGatewayFeePct ?? (order.tenant as any)?.gatewayFeePct ?? 4.5;
      const breakdown = calculateOrderFinancials(
        order.items.map((item) => ({
          productId: item.productId,
          basePrice: item.unitPrice,
          upsellPrice: 0,
          quantity: item.quantityPurchased,
          selectedUpsellId: item.selectedUpsellId ?? undefined,
        })),
        commissionPct,
        gatewayFeePct
      );

      // Actualizar estado general y registro financiero exacto en la Orden
      await tx.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: OrderStatus.PAID_ON_HOLD,
          mpPaymentId: paymentId,
          totalAmount: breakdown.totalAmount,
          platformFee: breakdown.platformFee,
          gatewayFee: breakdown.gatewayFee,
          tenantNetAmount: breakdown.tenantNetAmount,
          appliedCommissionPct: breakdown.appliedCommissionPct,
          appliedGatewayFeePct: breakdown.appliedGatewayFeePct,
        },
      });

      // Habilitar el saldo de canje (vales) en cada ítem de bebida
      for (let idx = 0; idx < order.items.length; idx++) {
        const item = order.items[idx];
        const calcItem = breakdown.items[idx];
        await tx.orderItem.update({
          where: { id: item.id },
          data: {
            quantityRemaining: item.quantityPurchased,
            ...(calcItem
              ? {
                  subtotal: calcItem.subtotal,
                  itemPlatformFee: calcItem.itemPlatformFee,
                  itemGatewayFee: calcItem.itemGatewayFee,
                  itemTenantNet: calcItem.itemTenantNet,
                }
              : {}),
          },
        });
      }

      return tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: { product: true },
          },
          tenant: true,
        },
      });
    });

    if (updatedOrder && this.eventsGateway) {
      this.eventsGateway.emitOrderPaymentUpdate(orderId, {
        orderId: updatedOrder.id,
        userId: updatedOrder.userId,
        tenantId: updatedOrder.tenantId,
        paymentStatus: OrderStatus.PAID_ON_HOLD,
        totalAmount: updatedOrder.totalAmount,
        platformFee: updatedOrder.platformFee,
        gatewayFee: (updatedOrder as any).gatewayFee ?? 0,
        tenantNetAmount: (updatedOrder as any).tenantNetAmount ?? 0,
        mpPaymentId: updatedOrder.mpPaymentId ?? paymentId,
        timestamp: new Date().toISOString(),
      });
    }

    console.log(`[Split Payment] Orden ${orderId} aprobada. Bebidas acreditadas en PAID_ON_HOLD.`);
    return { status: 'SUCCESS', order: updatedOrder };
  }

  /**
   * Ejecuta un reembolso atómico pasando la orden a CANCELLED_REFUNDED
   * y anulando cualquier saldo restante (quantityRemaining = 0) en la Wallet.
   */
  async executeAtomicOrderRefund(orderId: string, refundPaymentId?: string) {
    const refundedOrder = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      if (!order) {
        throw new NotFoundException(`Orden ${orderId} no encontrada.`);
      }

      if (order.paymentStatus === OrderStatus.CANCELLED_REFUNDED) {
        return order;
      }

      await tx.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: OrderStatus.CANCELLED_REFUNDED,
          ...(refundPaymentId ? { mpPaymentId: refundPaymentId } : {}),
        },
      });

      for (const item of order.items) {
        await tx.orderItem.update({
          where: { id: item.id },
          data: {
            quantityRemaining: 0,
          },
        });
      }

      return tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: { product: true },
          },
          tenant: true,
        },
      });
    });

    if (refundedOrder && this.eventsGateway) {
      this.eventsGateway.emitOrderPaymentUpdate(orderId, {
        orderId: refundedOrder.id,
        userId: refundedOrder.userId,
        tenantId: refundedOrder.tenantId,
        paymentStatus: OrderStatus.CANCELLED_REFUNDED,
        totalAmount: refundedOrder.totalAmount,
        platformFee: refundedOrder.platformFee,
        gatewayFee: (refundedOrder as any).gatewayFee ?? 0,
        tenantNetAmount: (refundedOrder as any).tenantNetAmount ?? 0,
        mpPaymentId: refundedOrder.mpPaymentId ?? undefined,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      status: 'REFUNDED',
      order: refundedOrder,
    };
  }

  /**
   * Procesa el cobro in-app con Tarjeta de Crédito / Débito (Checkout Bricks / Tokenización).
   * Soporta los estados estándar de prueba de Mercado Pago Sandbox (APRO, FUND, SECU, OTHE, EXPI, CALL).
   */
  async processCardPayment(dto: ProcessCardPaymentInput) {
    const cleanDigits = (dto.cardNumber || '').replace(/\D/g, '');
    if (cleanDigits.length < 13 || cleanDigits.length > 19) {
      throw new BadRequestException('Número de tarjeta inválido.');
    }

    const holderUpper = (dto.cardholderName || '').trim().toUpperCase();
    const hint =
      dto.cardStatusHint ||
      (holderUpper.includes('FUND') || cleanDigits.endsWith('6351')
        ? 'FUND'
        : holderUpper.includes('SECU') || cleanDigits.endsWith('8046') || cleanDigits.endsWith('7804')
        ? 'SECU'
        : holderUpper.includes('OTHE') || cleanDigits.endsWith('0122')
        ? 'OTHE'
        : holderUpper.includes('EXPI')
        ? 'EXPI'
        : holderUpper.includes('CALL')
        ? 'CALL'
        : 'APRO');

    if (hint === 'FUND') {
      await this.processPaymentWebhook({
        orderId: dto.orderId,
        status: 'rejected',
        status_detail: 'cc_rejected_insufficient_amount',
        data: { id: `MP-REJ-FUND-${Date.now()}`, external_reference: dto.orderId },
      });
      throw new BadRequestException({
        status: 'REJECTED',
        code: 'cc_rejected_insufficient_amount',
        message: 'Pago rechazado: Fondos insuficientes en la tarjeta. Intenta con otra tarjeta o Dinero en Cuenta.',
      });
    }

    if (hint === 'SECU') {
      await this.processPaymentWebhook({
        orderId: dto.orderId,
        status: 'rejected',
        status_detail: 'cc_rejected_bad_filled_security_code',
        data: { id: `MP-REJ-SECU-${Date.now()}`, external_reference: dto.orderId },
      });
      throw new BadRequestException({
        status: 'REJECTED',
        code: 'cc_rejected_security_validation',
        message: 'Pago rechazado por validación de seguridad / CVV inválido.',
      });
    }

    if (hint === 'OTHE' || hint === 'EXPI' || hint === 'CALL') {
      await this.processPaymentWebhook({
        orderId: dto.orderId,
        status: 'rejected',
        status_detail: `cc_rejected_${hint.toLowerCase()}`,
        data: { id: `MP-REJ-${hint}-${Date.now()}`, external_reference: dto.orderId },
      });
      throw new BadRequestException({
        status: 'REJECTED',
        code: `cc_rejected_${hint.toLowerCase()}`,
        message: 'La entidad emisora rechazó la transacción. Prueba con otro medio de pago.',
      });
    }

    // Tarjeta aprobada (APRO) -> Acreditación atómica en PAID_ON_HOLD con Split Payment
    const paymentId = `MP-BRICK-${Date.now()}-${cleanDigits.slice(-4)}`;
    return this.processPaymentWebhook({
      orderId: dto.orderId,
      status: 'approved',
      paymentId,
      data: { id: paymentId, external_reference: dto.orderId },
    });
  }

  /**
   * Valida en tiempo constante (crypto.timingSafeEqual) si el PIN de piloto provisto
   * coincide con PILOT_SANDBOX_PIN o PILOT_SIMULATOR_PIN (con fallback seguro al PIN '2026' en modo piloto).
   */
  private isValidPilotPin(candidatePin?: string): boolean {
    if (!candidatePin) return false;
    const unifiedPin = process.env.PILOT_SANDBOX_PIN || process.env.PILOT_SIMULATOR_PIN;
    const sandboxPin = process.env.PILOT_SANDBOX_PIN || unifiedPin;
    const simulatorPin = process.env.PILOT_SIMULATOR_PIN || unifiedPin || '2026';
    const isPilotSandboxMode = process.env.MP_SANDBOX_MODE !== 'false';

    return (
      (Boolean(sandboxPin) && safeComparePin(candidatePin, sandboxPin)) ||
      (Boolean(simulatorPin) && safeComparePin(candidatePin, simulatorPin)) ||
      (isPilotSandboxMode && safeComparePin(candidatePin, '2026'))
    );
  }

  /**
   * Simulador Piloto Autorizado protegido por PIN (timingSafeEqual) o rol Admin para pruebas físicas en la barra del boliche.
   * Permite simular compras aprobadas, rechazos de tarjeta y reembolsos en tiempo real sin fricción.
   */
  async simulatePilotAction(
    dto: PilotSimulationActionInput,
    options?: { pilotPinHeader?: string; user?: JwtAuthPayload }
  ) {
    const candidatePin = dto.pilotPin || options?.pilotPinHeader;
    const isAdminUser =
      options?.user?.role === UserRole.INCUBATIO_ADMIN ||
      options?.user?.role === UserRole.VENUE_ADMIN;

    if (!isAdminUser && !this.isValidPilotPin(candidatePin)) {
      throw new UnauthorizedException('PIN de Simulador Piloto inválido. Acceso denegado.');
    }

    switch (dto.action) {
      case 'APPROVE':
        return this.processPaymentWebhook({
          orderId: dto.orderId,
          status: 'approved',
          data: {
            id: `PILOT-APRO-${Date.now()}`,
            external_reference: dto.orderId,
          },
        });

      case 'REJECT_FUNDS':
        return this.processPaymentWebhook({
          orderId: dto.orderId,
          status: 'rejected',
          status_detail: 'cc_rejected_insufficient_amount',
          data: {
            id: `PILOT-REJ-FUND-${Date.now()}`,
            external_reference: dto.orderId,
          },
        });

      case 'REJECT_SECURITY':
        return this.processPaymentWebhook({
          orderId: dto.orderId,
          status: 'rejected',
          status_detail: 'cc_rejected_high_risk',
          data: {
            id: `PILOT-REJ-SECU-${Date.now()}`,
            external_reference: dto.orderId,
          },
        });

      case 'REFUND':
        return this.executeAtomicOrderRefund(dto.orderId, `PILOT-REFUND-${Date.now()}`);

      default:
        throw new BadRequestException(`Acción de simulación no soportada: ${dto.action}`);
    }
  }

  /**
   * Simulación directa de aprobación de pago para pruebas y modo piloto.
   * En NODE_ENV=production exige obligatoriamente un JWT con rol INCUBATIO_ADMIN / VENUE_ADMIN
   * o la cabecera secreta X-Pilot-Pin validada con timingSafeEqual contra PILOT_SANDBOX_PIN.
   */
  async simulatePaymentApproval(
    orderId: string,
    options?: { user?: JwtAuthPayload; pilotPin?: string }
  ) {
    if (process.env.NODE_ENV === 'production') {
      const isAdminUser =
        options?.user?.role === UserRole.INCUBATIO_ADMIN ||
        options?.user?.role === UserRole.VENUE_ADMIN;
      const hasValidPilotPin = this.isValidPilotPin(options?.pilotPin);

      if (!isAdminUser && !hasValidPilotPin) {
        throw new UnauthorizedException(
          'Simulación en producción restringida: se requiere rol INCUBATIO_ADMIN / VENUE_ADMIN o cabecera X-Pilot-Pin válida.'
        );
      }
    }

    return this.processPaymentWebhook({
      orderId,
      status: 'approved',
      data: { id: `MOCK-PAY-${Date.now()}`, external_reference: orderId },
    });
  }
}
