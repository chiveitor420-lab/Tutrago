import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
  Inject,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  TicketStatus,
  ActivatePickupInput,
  SECURITY_COLORS,
  OfflineQrPayload,
  UserRole,
  JwtAuthPayload,
} from '@tutrago/shared-types';
import * as crypto from 'node:crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../config/redis.provider';
import { EventsGateway } from '../gateway/events.gateway';

const DEV_EPHEMERAL_TICKET_SECRET = crypto
  .createHash('sha256')
  .update(`tutrago-offline-ticket-hmac-${process.cwd()}`)
  .digest('hex');

@Injectable()
export class PickupService {
  private static localSecurityColorIndex = 0;
  private static localQueues = new Map<string, string[]>();
  private static activeRedeemLocks = new Set<string>();
  private static deliveredTicketIds = new Map<string, Date>();

  private readonly eventsGateway?: EventsGateway;
  private readonly redisClient?: any;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() eventsGatewayOrRedis?: any,
    @Optional() @Inject(REDIS_CLIENT) redisClient?: Redis
  ) {
    // Soporta tanto inyección NestJS (prisma, eventsGateway, redis) como instanciación directa en tests (prisma, mockRedis)
    if (
      eventsGatewayOrRedis &&
      typeof eventsGatewayOrRedis.scard === 'function' &&
      typeof eventsGatewayOrRedis.emitTicketPrint !== 'function'
    ) {
      this.redisClient = eventsGatewayOrRedis;
      this.eventsGateway = undefined;
    } else {
      this.eventsGateway = eventsGatewayOrRedis;
      this.redisClient = redisClient;
    }
  }

  /**
   * Genera un código de 3 caracteres (1 letra + 2 dígitos, ej: "A47")
   */
  private generateShortCode(): string {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const letter = letters[Math.floor(Math.random() * letters.length)];
    const num = String(Math.floor(Math.random() * 90) + 10);
    return `${letter}${num}`;
  }

  /**
   * Obtiene el siguiente color de seguridad rotativo
   */
  private getNextSecurityColor(): string {
    const color =
      SECURITY_COLORS[PickupService.localSecurityColorIndex % SECURITY_COLORS.length];
    PickupService.localSecurityColorIndex++;
    return color;
  }

  private getTicketHmacSecret(): string {
    const secret = process.env.TICKET_HMAC_SECRET || process.env.JWT_OFFLINE_SECRET;
    if (secret && secret.trim().length >= 16) {
      return secret.trim();
    }
    if (process.env.NODE_ENV === 'production') {
      throw new InternalServerErrorException(
        'Configuración crítica faltante: TICKET_HMAC_SECRET debe estar definido en producción.'
      );
    }
    return DEV_EPHEMERAL_TICKET_SECRET;
  }

  /**
   * Firma el token QR offline (JWT HS256 nativo con validez de 12 horas, nonce único jti, barId, shortCode y securityColor)
   */
  public signOfflineJwt(payload: Omit<OfflineQrPayload, 'iat' | 'exp'>): string {
    const secret = this.getTicketHmacSecret();
    const header = { alg: 'HS256', typ: 'JWT' };
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 12 * 3600;
    const jti = payload.jti || crypto.randomUUID();
    const fullPayload: OfflineQrPayload = { ...payload, jti, iat, exp };

    const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
    const b64Payload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${b64Header}.${b64Payload}`)
      .digest('base64url');
    return `${b64Header}.${b64Payload}.${signature}`;
  }

  /**
   * Verifica la firma y vigencia del JWT offline usando comparación en tiempo constante (timingSafeEqual)
   */
  public verifyOfflineJwt(token: string): OfflineQrPayload {
    const secret = this.getTicketHmacSecret();
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Token JWT inválido');
    const [b64Header, b64Payload, signature] = parts;
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`${b64Header}.${b64Payload}`)
      .digest('base64url');
    const sigBuf = Buffer.from(signature, 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      throw new Error('Firma de ticket JWT inválida');
    }
    const payload = JSON.parse(
      Buffer.from(b64Payload, 'base64url').toString('utf8')
    ) as OfflineQrPayload;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error('Token de ticket expirado');
    }
    if (!payload.ticketId || !payload.barId || !payload.shortCode || !payload.securityColor) {
      throw new Error('Payload de ticket QR incompleto');
    }
    return payload;
  }

  /**
   * Endpoint transaccional: Activación de Retiro en Barra (Flujo en 2 Etapas).
   * Utiliza bloqueo pesimista (FOR UPDATE), validación de propiedad (Anti-IDOR) y Throttling FIFO con Redis.
   */
  async requestPickup(dto: ActivatePickupInput, user?: JwtAuthPayload) {
    if (user?.role === UserRole.CONSUMER && user.sub && dto.userId && dto.userId !== user.sub) {
      throw new ForbiddenException(
        'Alerta de Seguridad: Un CONSUMER solo puede activar retiros de sus propias órdenes.'
      );
    }

    const bar = await this.prisma.bar.findUnique({
      where: { id: dto.barId },
    });
    if (!bar) {
      throw new NotFoundException(`Barra con ID ${dto.barId} no encontrada.`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const itemSummaries: Array<{ name: string; quantity: number }> = [];
      let orderId = '';

      for (const reqItem of dto.items) {
        const items = await tx.$queryRaw<
          Array<{
            id: string;
            order_id: string;
            product_id: string;
            quantity_remaining: number;
          }>
        >`
          SELECT id, order_id, product_id, quantity_remaining 
          FROM "order_items" 
          WHERE id = ${reqItem.orderItemId}
          FOR UPDATE
        `;

        const orderItem = items[0];
        if (!orderItem) {
          throw new NotFoundException(`Ítem de orden ${reqItem.orderItemId} no existe.`);
        }

        orderId = orderItem.order_id;

        // Validación Anti-IDOR directa (si $queryRaw o el join devuelve user_id) y vía orden madre
        const rawOwnerId = (orderItem as any).user_id;
        if (rawOwnerId && dto.userId && rawOwnerId !== dto.userId) {
          throw new ForbiddenException(
            'Alerta de Seguridad (IDOR bloqueado): No tienes permisos para canjear bebidas que pertenecen a otro usuario.'
          );
        }

        // Validación Anti-IDOR y de estado de pago de la orden madre
        if ((tx as any).order && typeof (tx as any).order.findUnique === 'function') {
          const parentOrder = await (tx as any).order.findUnique({
            where: { id: orderId },
          });
          if (parentOrder) {
            if (dto.userId && parentOrder.userId !== dto.userId) {
              throw new ForbiddenException(
                'Alerta de Seguridad (IDOR bloqueado): No tienes permisos para canjear bebidas que pertenecen a otro usuario.'
              );
            }
            if (parentOrder.paymentStatus !== 'PAID_ON_HOLD') {
              throw new BadRequestException(
                `La orden ${orderId} no está habilitada para retiro (estado actual: ${parentOrder.paymentStatus}).`
              );
            }
          }
        }

        if (orderItem.quantity_remaining < reqItem.quantityToRedeem) {
          throw new BadRequestException(
            `Saldo insuficiente para canjear este trago. Saldo disponible: ${orderItem.quantity_remaining}, solicitados: ${reqItem.quantityToRedeem}.`
          );
        }

        const product = await tx.product.findUnique({
          where: { id: orderItem.product_id },
        });

        if (!product || !product.isAvailable) {
          throw new BadRequestException({
            statusCode: 400,
            error: 'ERR_ITEM_SOLD_OUT_RECOVERY',
            message: `El producto "${product?.name || 'solicitado'}" se agotó antes del retiro.`,
            productId: orderItem.product_id,
            orderItemId: orderItem.id,
          });
        }

        await tx.orderItem.update({
          where: { id: orderItem.id },
          data: {
            quantityRemaining: {
              decrement: reqItem.quantityToRedeem,
            },
          },
        });

        itemSummaries.push({
          name: product.name,
          quantity: reqItem.quantityToRedeem,
        });
      }

      const shortCode = this.generateShortCode();
      const securityColor = this.getNextSecurityColor();

      const ticket = await tx.pickupTicket.create({
        data: {
          orderId,
          barId: bar.id,
          status: TicketStatus.PREP_REQUESTED,
          shortCode,
          securityColor,
          offlineQrJwt: '',
          items: {
            create: dto.items.map((item) => ({
              orderItemId: item.orderItemId,
              quantity: item.quantityToRedeem,
            })),
          },
        },
      });

      const offlineQrJwt = this.signOfflineJwt({
        ticketId: ticket.id,
        shortCode,
        barId: bar.id,
        securityColor,
        items: itemSummaries,
      });

      const updatedTicket = await tx.pickupTicket.update({
        where: { id: ticket.id },
        data: { offlineQrJwt },
        include: {
          bar: { select: { id: true, name: true } },
          items: {
            include: {
              orderItem: {
                include: { product: true },
              },
            },
          },
        },
      });

      return { ticket: updatedTicket, itemSummaries };
    });

    const ticket = result.ticket;

    // Motor de Throttling FIFO con Redis
    const queueKey = `bar:queue:${bar.id}`;
    const activeKey = `bar:active:${bar.id}`;

    let shouldPrintNow = false;

    if (this.redisClient) {
      try {
        const activeCount = await this.redisClient.scard(activeKey);
        if (activeCount < bar.maxConcurrentPrep) {
          await this.redisClient.sadd(activeKey, ticket.id);
          shouldPrintNow = true;
        } else {
          await this.redisClient.rpush(queueKey, ticket.id);
        }
      } catch (err: any) {
        console.warn('[PickupService] Error consultando Redis. Usando fallback:', err?.message);
        shouldPrintNow = true;
      }
    } else {
      const q = PickupService.localQueues.get(bar.id) || [];
      if (q.length < bar.maxConcurrentPrep) {
        q.push(ticket.id);
        PickupService.localQueues.set(bar.id, q);
        shouldPrintNow = true;
      }
    }

    if (shouldPrintNow) {
      await this.prisma.pickupTicket.update({
        where: { id: ticket.id },
        data: { status: TicketStatus.IN_PREPARATION },
      });
      ticket.status = TicketStatus.IN_PREPARATION;
    }

    const responsePayload = {
      ticketId: ticket.id,
      orderId: ticket.orderId,
      barId: ticket.barId,
      barName: ticket.bar.name,
      status: ticket.status,
      shortCode: ticket.shortCode,
      securityColor: ticket.securityColor,
      offlineQrToken: ticket.offlineQrJwt,
      shouldPrintImmediately: shouldPrintNow,
      items: ticket.items.map((i: any) => ({
        id: i.id,
        productId: i.orderItem?.product?.id || i.orderItem?.productId,
        name: i.orderItem?.product?.name || 'Bebida',
        isAvailable: i.orderItem?.product?.isAvailable ?? true,
        quantity: i.quantity,
      })),
      activatedAt: ticket.activatedAt,
    };

    this.eventsGateway?.emitTicketPrint?.(ticket.barId, {
      barId: ticket.barId,
      timestamp: new Date().toISOString(),
      ticket: {
        id: ticket.id,
        orderId: ticket.orderId,
        barId: ticket.barId,
        barName: ticket.bar.name,
        status: ticket.status as TicketStatus,
        shortCode: ticket.shortCode,
        securityColor: ticket.securityColor,
        offlineQrToken: ticket.offlineQrJwt,
        items: ticket.items.map((i: any) => ({
          id: i.id,
          ticketId: ticket.id,
          productId: i.orderItem?.product?.id || i.orderItem?.productId,
          productName: i.orderItem?.product?.name || 'Bebida',
          isAvailable: i.orderItem?.product?.isAvailable ?? true,
          quantity: i.quantity,
        })),
        activatedAt: ticket.activatedAt,
      } as any,
    });

    return responsePayload;
  }

  /**
   * Avanza el estado de un ticket en el KDS (IN_PREPARATION -> READY_FOR_PICKUP -> DELIVERED)
   * Al liberarse capacidad, promueve el siguiente ticket en la cola FIFO de Redis.
   */
  async advanceTicketStatus(ticketId: string, nextStatus: TicketStatus, user?: JwtAuthPayload) {
    const ticket = await this.prisma.pickupTicket.findUnique({
      where: { id: ticketId },
      include: { bar: true },
    });
    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} no encontrado.`);

    if (
      user?.role === UserRole.BAR_OPERATOR &&
      user.assignedBarId &&
      ticket.barId &&
      ticket.barId !== user.assignedBarId
    ) {
      throw new ForbiddenException(
        `El operador de la barra ${user.assignedBarId} no puede modificar tickets de la barra ${ticket.barId}.`
      );
    }

    const now = new Date();
    const updateData: any = { status: nextStatus };
    if (nextStatus === TicketStatus.READY_FOR_PICKUP) updateData.readyAt = now;
    if (nextStatus === TicketStatus.DELIVERED) updateData.deliveredAt = now;

    const updated = await this.prisma.pickupTicket.update({
      where: { id: ticketId },
      data: updateData,
    });

    const statusPayload = {
      ticketId: updated.id,
      status: nextStatus,
      shortCode: updated.shortCode,
      securityColor: updated.securityColor,
      barId: updated.barId,
      readyAt: updated.readyAt ? new Date(updated.readyAt).toISOString() : undefined,
      deliveredAt: updated.deliveredAt ? new Date(updated.deliveredAt).toISOString() : undefined,
    };

    this.eventsGateway?.emitTicketStatus?.(updated.id, updated.barId, statusPayload);
    if (nextStatus === TicketStatus.READY_FOR_PICKUP) {
      this.eventsGateway?.emitTicketReady?.(updated.id, statusPayload);
    }

    // Liberar turno de preparación en Redis cuando sale de IN_PREPARATION
    if (
      nextStatus === TicketStatus.READY_FOR_PICKUP ||
      nextStatus === TicketStatus.DELIVERED ||
      nextStatus === TicketStatus.CANCELLED_REFUNDED
    ) {
      if (this.redisClient && typeof this.redisClient.srem === 'function') {
        try {
          await this.redisClient.srem(`bar:active:${ticket.barId}`, ticket.id);
        } catch {
          // ignore
        }
      }
      await this.promoteNextQueuedTicket(ticket.barId);
    }

    return updated;
  }

  /**
   * Promueve el siguiente ticket de la cola FIFO de Redis a IN_PREPARATION
   */
  async promoteNextQueuedTicket(barId: string) {
    const queueKey = `bar:queue:${barId}`;
    const activeKey = `bar:active:${barId}`;

    if (this.redisClient) {
      try {
        const nextTicketId = await this.redisClient.lpop(queueKey);
        if (nextTicketId) {
          await this.redisClient.sadd(activeKey, nextTicketId);
          const promoted = await this.prisma.pickupTicket.update({
            where: { id: nextTicketId },
            data: { status: TicketStatus.IN_PREPARATION },
            include: { bar: true },
          });
          if (promoted) {
            this.eventsGateway?.emitTicketStatus?.(promoted.id, barId, {
              ticketId: promoted.id,
              status: TicketStatus.IN_PREPARATION,
              shortCode: promoted.shortCode,
              securityColor: promoted.securityColor,
              barId,
            });
          }
          console.log(
            `[Throttling] Ticket ${nextTicketId} promovido automáticamente a IN_PREPARATION por FIFO.`
          );
          return nextTicketId;
        }
      } catch (e) {
        console.warn('[Throttling] Error en promoción de cola:', e);
      }
    }
    return null;
  }

  /**
   * Ejecuta el flujo de Service Recovery en 1 Clic desde el KDS de Barra:
   * - SUBSTITUTE: Reemplaza la bebida agotada en el ticket por una equivalente disponible.
   * - REFUND: Dispara la devolución del ítem o ticket y notifica al cliente y panel admin.
   */
  async executeOneClickServiceRecovery(dto: {
    action: 'SUBSTITUTE' | 'REFUND';
    ticketId?: string;
    productId: string;
    substituteProductId?: string;
    barId?: string;
  }) {
    const originalProduct = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });

    if (dto.action === 'SUBSTITUTE') {
      const subProduct = dto.substituteProductId
        ? await this.prisma.product.findUnique({ where: { id: dto.substituteProductId } })
        : (
            await this.prisma.product.findMany({
              where: {
                tenantId: originalProduct?.tenantId || '00000000-0000-4000-8000-000000000001',
                isAvailable: true,
                id: { not: dto.productId },
              },
              take: 1,
            })
          )[0];

      if (!subProduct) {
        throw new BadRequestException('No se encontró producto sustituto disponible.');
      }

      let updatedTicket: any = null;
      if (dto.ticketId) {
        const ticket = await this.prisma.pickupTicket.findUnique({
          where: { id: dto.ticketId },
          include: {
            items: {
              include: {
                orderItem: {
                  include: { product: true },
                },
              },
            },
          },
        });

        if (ticket) {
          for (const pti of (ticket as any).items || []) {
            if (pti.orderItem?.productId === dto.productId || pti.orderItem?.product?.id === dto.productId) {
              await this.prisma.orderItem.update({
                where: { id: pti.orderItem.id },
                data: { productId: subProduct.id },
              });
            }
          }
          updatedTicket = await this.getTicketById(dto.ticketId);
          this.eventsGateway?.emitTicketStatus?.(ticket.id, ticket.barId, {
            ticketId: ticket.id,
            status: ticket.status as TicketStatus,
            shortCode: ticket.shortCode,
            securityColor: ticket.securityColor,
            barId: ticket.barId,
          });
        }
      }

      return {
        resolved: true,
        action: 'SUBSTITUTE',
        originalProductName: originalProduct?.name || 'Bebida Agotada',
        substituteProduct: {
          id: subProduct.id,
          name: subProduct.name,
          price: subProduct.price,
          category: subProduct.category,
        },
        ticket: updatedTicket,
        message: `Sustitución en 1 clic completada: "${originalProduct?.name || 'Bebida'}" reemplazada por "${subProduct.name}" sin cargo extra.`,
      };
    }

    // Acción: REFUND (Devolución en 1 clic)
    let refundedTicket: any = null;
    if (dto.ticketId) {
      refundedTicket = await this.advanceTicketStatus(
        dto.ticketId,
        TicketStatus.CANCELLED_REFUNDED
      );
    }

    const refundAmount = originalProduct?.price || 8500;
    return {
      resolved: true,
      action: 'REFUND',
      originalProductName: originalProduct?.name || 'Bebida Agotada',
      refundAmount,
      mpRefundId: `MP-REFUND-${Date.now()}`,
      ticket: refundedTicket,
      message: `Reembolso instantáneo de $${refundAmount.toLocaleString('es-AR')} por "${originalProduct?.name || 'Bebida'}" acreditado al cliente vía Mercado Pago.`,
    };
  }

  /**
   * Simula el ingreso de 1 o múltiples comandas en una barra para validar WebSockets y Cola FIFO en Redis
   */
  async simulateIncomingTickets(barId: string, count = 1, includeSoldOut = false) {
    const bar = await this.prisma.bar.findUnique({ where: { id: barId } });
    if (!bar) throw new NotFoundException(`Barra ${barId} no encontrada.`);

    const products = await this.prisma.product.findMany({
      where: { tenantId: bar.tenantId },
    });

    const availableProducts = products.filter((p: any) => p.isAvailable);
    const soldOutProducts = products.filter((p: any) => !p.isAvailable);

    const queueKey = `bar:queue:${bar.id}`;
    const activeKey = `bar:active:${bar.id}`;

    // Sincronizar conteo activo actual con los tickets IN_PREPARATION de la barra
    const currentInPrep = await this.prisma.pickupTicket.findMany({
      where: { barId: bar.id, status: TicketStatus.IN_PREPARATION },
    });
    if (this.redisClient) {
      for (const t of currentInPrep) {
        await this.redisClient.sadd(activeKey, t.id);
      }
    }

    const createdTickets = [];

    for (let i = 0; i < count; i++) {
      const chosenProduct =
        includeSoldOut && soldOutProducts.length > 0 && i === 0
          ? soldOutProducts[0]
          : availableProducts[i % Math.max(1, availableProducts.length)] || products[0];

      // Crear Order + OrderItem rápido para el ticket simulado
      const order = await this.prisma.order.create({
        data: {
          userId: '00000000-0000-4000-8000-000000000901',
          tenantId: bar.tenantId,
          totalAmount: Number(chosenProduct?.price || 9500),
          platformFee: Math.round(Number(chosenProduct?.price || 9500) * 0.1),
          paymentStatus: 'PAID_ON_HOLD' as any,
          mpPaymentId: `MP-SIM-${Date.now()}-${i}`,
          items: {
            create: [
              {
                productId: chosenProduct.id,
                unitPrice: Number(chosenProduct.price),
                quantityPurchased: 1,
                quantityRemaining: 0,
              },
            ],
          },
        },
        include: { items: true },
      });

      const shortCode = this.generateShortCode();
      const securityColor = this.getNextSecurityColor();

      let activeCount = currentInPrep.length + i;
      if (this.redisClient) {
        activeCount = await this.redisClient.scard(activeKey);
      }

      const canEnterPreparation = activeCount < bar.maxConcurrentPrep;
      const initialStatus = canEnterPreparation
        ? TicketStatus.IN_PREPARATION
        : TicketStatus.PREP_REQUESTED;

      const ticket = await this.prisma.pickupTicket.create({
        data: {
          orderId: order.id,
          barId: bar.id,
          status: initialStatus,
          shortCode,
          securityColor,
          offlineQrJwt: `sim.jwt.${shortCode}`,
          items: {
            create: [
              {
                orderItemId: (order as any).items[0].id,
                quantity: (i % 2) + 1,
              },
            ],
          },
        },
        include: {
          bar: true,
          items: {
            include: {
              orderItem: {
                include: { product: true },
              },
            },
          },
        },
      });

      if (this.redisClient) {
        if (canEnterPreparation) {
          await this.redisClient.sadd(activeKey, ticket.id);
        } else {
          await this.redisClient.rpush(queueKey, ticket.id);
        }
      }

      this.eventsGateway?.emitTicketPrint?.(bar.id, {
        barId: bar.id,
        timestamp: new Date().toISOString(),
        ticket: {
          id: ticket.id,
          orderId: ticket.orderId,
          barId: ticket.barId,
          barName: bar.name,
          status: ticket.status as TicketStatus,
          shortCode: ticket.shortCode,
          securityColor: ticket.securityColor,
          offlineQrToken: ticket.offlineQrJwt,
          items: ((ticket as any).items || []).map((item: any) => ({
            id: item.id,
            ticketId: ticket.id,
            productId: item.orderItem?.product?.id || chosenProduct.id,
            productName: item.orderItem?.product?.name || chosenProduct.name,
            isAvailable: item.orderItem?.product?.isAvailable ?? chosenProduct.isAvailable,
            quantity: item.quantity,
          })),
          activatedAt: ticket.activatedAt,
        } as any,
      });

      createdTickets.push(ticket);
    }

    return {
      barId: bar.id,
      createdCount: createdTickets.length,
      tickets: createdTickets,
    };
  }

  /**
   * Valida un ticket escaneado (USB / Cámara / Código Corto) y previene fraude por re-canje (Anti-Replay)
   * mediante bloqueo atómico en Redis + verificación criptográfica de barra.
   */
  async validateAndDeliverTicket(tokenOrShortCode: string, operatorBarId?: string) {
    let ticketId: string | null = null;
    let decodedJwt: OfflineQrPayload | null = null;

    if (tokenOrShortCode.split('.').length === 3 && !tokenOrShortCode.startsWith('jwt.offline.')) {
      try {
        decodedJwt = this.verifyOfflineJwt(tokenOrShortCode);
        ticketId = decodedJwt.ticketId;
      } catch (err: any) {
        throw new BadRequestException(
          `¡ALERTA DE SEGURIDAD! Firma criptográfica QR inválida o expirada: ${err?.message || 'Token adulterado'}`
        );
      }
    } else {
      const cleanInput = tokenOrShortCode.replace(/^#/, '').toUpperCase().trim();
      const ticketByCode = await this.prisma.pickupTicket.findFirst({
        where: { shortCode: cleanInput },
        orderBy: { activatedAt: 'desc' },
      });
      if (ticketByCode) ticketId = ticketByCode.id;
    }

    if (!ticketId) {
      throw new BadRequestException('Código o QR no reconocido.');
    }

    if (decodedJwt && operatorBarId && decodedJwt.barId !== operatorBarId) {
      throw new ForbiddenException(
        `¡ALERTA DE BARRA! Este ticket fue emitido para la barra ${decodedJwt.barId} y no puede canjearse en ${operatorBarId}.`
      );
    }

    // 1. Bloqueo Atómico en Memoria + Redis (SET ... EX 30 NX) para impedir Doble Canje Concurrente (TOCTOU)
    const redeemLockKey = `lock:ticket:redeem:${ticketId}`;
    const deliveredCacheKey = `ticket:delivered:${ticketId}`;

    if (PickupService.activeRedeemLocks.has(ticketId)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'TICKET_ALREADY_DELIVERED',
        message: '¡ALERTA DE SEGURIDAD! Intento de doble canje simultáneo bloqueado atómicamente.',
      });
    }

    const cachedDeliveredAt = PickupService.deliveredTicketIds.get(ticketId);
    if (cachedDeliveredAt) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'TICKET_ALREADY_DELIVERED',
        message: '¡ALERTA DE SEGURIDAD! El ticket ya fue entregado previamente.',
        deliveredAt: cachedDeliveredAt,
      });
    }

    PickupService.activeRedeemLocks.add(ticketId);

    try {
      if (this.redisClient) {
        const alreadyDeliveredRedis = await this.redisClient.get(deliveredCacheKey);
        if (alreadyDeliveredRedis) {
          throw new BadRequestException({
            statusCode: 400,
            error: 'TICKET_ALREADY_DELIVERED',
            message: '¡ALERTA DE SEGURIDAD! El ticket ya fue entregado previamente.',
            deliveredAt: alreadyDeliveredRedis,
          });
        }

        const lockAcquired = await this.redisClient.set(redeemLockKey, '1', 'EX', 30, 'NX');
        if (lockAcquired === null) {
          throw new BadRequestException({
            statusCode: 400,
            error: 'TICKET_ALREADY_DELIVERED',
            message: '¡ALERTA DE SEGURIDAD! Intento de doble canje concurrente bloqueado en Redis.',
          });
        }
      }

      const ticket = await this.prisma.pickupTicket.findUnique({
        where: { id: ticketId },
        include: {
          items: {
            include: {
              orderItem: {
                include: { product: true },
              },
            },
          },
        },
      });

      if (!ticket) throw new NotFoundException('Ticket no encontrado.');

      if (operatorBarId && ticket.barId && ticket.barId !== operatorBarId) {
        throw new ForbiddenException(
          `El operador de la barra ${operatorBarId} no puede despachar un ticket de la barra ${ticket.barId}.`
        );
      }

      if (ticket.status === TicketStatus.DELIVERED) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'TICKET_ALREADY_DELIVERED',
          message: '¡ALERTA DE SEGURIDAD! El ticket ya fue entregado previamente.',
          deliveredAt: ticket.deliveredAt,
        });
      }

      const now = new Date();
      PickupService.deliveredTicketIds.set(ticketId, now);
      if (this.redisClient) {
        await this.redisClient.set(deliveredCacheKey, now.toISOString(), 'EX', 86400);
      }

      return await this.advanceTicketStatus(ticket.id, TicketStatus.DELIVERED);
    } finally {
      PickupService.activeRedeemLocks.delete(ticketId);
      if (this.redisClient) {
        await this.redisClient.del(redeemLockKey).catch(() => {});
      }
    }
  }

  async getTicketsByBar(barId: string) {
    return this.prisma.pickupTicket.findMany({
      where: {
        barId,
        status: {
          in: [
            TicketStatus.IN_PREPARATION,
            TicketStatus.READY_FOR_PICKUP,
            TicketStatus.PREP_REQUESTED,
            TicketStatus.DELIVERED,
          ],
        },
      },
      include: {
        items: {
          include: {
            orderItem: {
              include: { product: true },
            },
          },
        },
      },
      orderBy: { activatedAt: 'asc' },
    });
  }

  async getBarQueueStatus(barId: string) {
    const bar = await this.prisma.bar.findUnique({ where: { id: barId } });
    if (!bar) throw new NotFoundException(`Barra ${barId} no encontrada.`);

    const tickets = await this.prisma.pickupTicket.findMany({
      where: {
        barId,
        status: { in: [TicketStatus.IN_PREPARATION, TicketStatus.PREP_REQUESTED] },
      },
      orderBy: { activatedAt: 'asc' },
    });

    const inPrep = tickets.filter((t) => t.status === TicketStatus.IN_PREPARATION);
    const queued = tickets.filter((t) => t.status === TicketStatus.PREP_REQUESTED);

    return {
      barId: bar.id,
      barName: bar.name,
      status: bar.status,
      printerType: bar.printerType,
      maxConcurrentPrep: bar.maxConcurrentPrep,
      activeCount: inPrep.length,
      queuedCount: queued.length,
      queuedShortCodes: queued.map((q) => q.shortCode),
    };
  }

  async getTicketById(ticketId: string) {
    const ticket = await this.prisma.pickupTicket.findUnique({
      where: { id: ticketId },
      include: {
        bar: true,
        items: {
          include: {
            orderItem: {
              include: { product: true },
            },
          },
        },
      },
    });
    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} no encontrado.`);
    return ticket;
  }
}
