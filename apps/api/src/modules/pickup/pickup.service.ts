import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Inject,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  TicketStatus,
  ActivatePickupInput,
  SECURITY_COLORS,
  OfflineQrPayload,
} from '@tutrago/shared-types';
import * as crypto from 'node:crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../config/redis.provider';

@Injectable()
export class PickupService {
  private static localShortCodeCounter = 1;
  private static localSecurityColorIndex = 0;
  private static localQueues = new Map<string, string[]>(); // Fallback en memoria si Redis no está disponible

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redisClient?: Redis
  ) {}

  /**
   * Genera un código de 3 caracteres (1 letra + 2 dígitos, ej: "A47")
   */
  private generateShortCode(): string {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Excluimos I y O para evitar confusiones
    const letter = letters[Math.floor(Math.random() * letters.length)];
    const num = String(Math.floor(Math.random() * 90) + 10); // 10 a 99
    return `${letter}${num}`;
  }

  /**
   * Obtiene el siguiente color de seguridad rotativo
   */
  private getNextSecurityColor(): string {
    const color = SECURITY_COLORS[PickupService.localSecurityColorIndex % SECURITY_COLORS.length];
    PickupService.localSecurityColorIndex++;
    return color;
  }

  /**
   * Firma el token QR offline (JWT HS256 nativo con validez de 12 horas para operar en modo avión)
   */
  public signOfflineJwt(payload: Omit<OfflineQrPayload, 'iat' | 'exp'>): string {
    const secret = process.env.JWT_OFFLINE_SECRET || 'tutrago_offline_ticket_secret_key_8841';
    const header = { alg: 'HS256', typ: 'JWT' };
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 12 * 3600;
    const fullPayload: OfflineQrPayload = { ...payload, iat, exp };

    const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
    const b64Payload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(`${b64Header}.${b64Payload}`).digest('base64url');
    return `${b64Header}.${b64Payload}.${signature}`;
  }

  /**
   * Verifica la firma y vigencia del JWT offline
   */
  public verifyOfflineJwt(token: string): OfflineQrPayload {
    const secret = process.env.JWT_OFFLINE_SECRET || 'tutrago_offline_ticket_secret_key_8841';
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Token JWT inválido');
    const [b64Header, b64Payload, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', secret).update(`${b64Header}.${b64Payload}`).digest('base64url');
    if (signature !== expectedSig) throw new Error('Firma de ticket JWT inválida');
    const payload = JSON.parse(Buffer.from(b64Payload, 'base64url').toString('utf8')) as OfflineQrPayload;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error('Token de ticket expirado');
    }
    return payload;
  }

  /**
   * Endpoint transaccional: Activación de Retiro en Barra (Flujo en 2 Etapas).
   * Utiliza bloqueo pesimista (FOR UPDATE) y Throttling FIFO con Redis.
   */
  async requestPickup(dto: ActivatePickupInput) {
    const bar = await this.prisma.bar.findUnique({
      where: { id: dto.barId },
    });
    if (!bar) {
      throw new NotFoundException(`Barra con ID ${dto.barId} no encontrada.`);
    }

    // 1. Ejecución con Bloqueo Pesimista en PostgreSQL para evitar condiciones de carrera
    const result = await this.prisma.$transaction(async (tx) => {
      // Bloqueamos y consultamos los OrderItems seleccionados
      const itemSummaries: Array<{ name: string; quantity: number }> = [];
      let orderId = '';

      for (const reqItem of dto.items) {
        // Bloqueo pesimista nativo: FOR UPDATE
        const items = await tx.$queryRaw<Array<{
          id: string;
          order_id: string;
          product_id: string;
          quantity_remaining: number;
        }>>`
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

        // Validar saldo suficiente
        if (orderItem.quantity_remaining < reqItem.quantityToRedeem) {
          throw new BadRequestException(
            `Saldo insuficiente para canjear este trago. Saldo disponible: ${orderItem.quantity_remaining}, solicitados: ${reqItem.quantityToRedeem}.`
          );
        }

        // Validar disponibilidad del producto (Switch is_available)
        const product = await tx.product.findUnique({
          where: { id: orderItem.product_id },
        });

        if (!product || !product.isAvailable) {
          // Devolvemos el código de error específico para el flujo de Service Recovery
          throw new BadRequestException({
            statusCode: 400,
            error: 'ERR_ITEM_SOLD_OUT_RECOVERY',
            message: `El producto "${product?.name || 'solicitado'}" se agotó antes del retiro.`,
            productId: orderItem.product_id,
            orderItemId: orderItem.id,
          });
        }

        // Descontar del saldo disponible
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

      // 2. Generar metadatos del Ticket
      const shortCode = this.generateShortCode();
      const securityColor = this.getNextSecurityColor();

      // 3. Crear el PickupTicket inicial en la base de datos
      const ticket = await tx.pickupTicket.create({
        data: {
          orderId,
          barId: bar.id,
          status: TicketStatus.PREP_REQUESTED,
          shortCode,
          securityColor,
          offlineQrJwt: '', // Lo completamos tras tener el ID
          items: {
            create: dto.items.map((item) => ({
              orderItemId: item.orderItemId,
              quantity: item.quantityToRedeem,
            })),
          },
        },
      });

      // 4. Firmar el token JWT offline
      const offlineQrJwt = this.signOfflineJwt({
        ticketId: ticket.id,
        shortCode,
        barId: bar.id,
        securityColor,
        items: itemSummaries,
      });

      // Actualizar el token firmado en el ticket
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

    // 5. Motor de Throttling FIFO con Redis
    const queueKey = `bar:queue:${bar.id}`;
    const activeKey = `bar:active:${bar.id}`;

    let shouldPrintNow = false;

    if (this.redisClient) {
      try {
        const activeCount = await this.redisClient.scard(activeKey);
        if (activeCount < bar.maxConcurrentPrep) {
          // Capacidad disponible en la barra: promover directo a IN_PREPARATION
          await this.redisClient.sadd(activeKey, ticket.id);
          shouldPrintNow = true;
        } else {
          // Barra saturada: encolar en cola FIFO de Redis
          await this.redisClient.rpush(queueKey, ticket.id);
        }
      } catch (err) {
        console.warn('[PickupService] Error consultando Redis. Usando fallback:', err.message);
        shouldPrintNow = true;
      }
    } else {
      // Fallback en memoria local
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

    return {
      ticketId: ticket.id,
      orderId: ticket.orderId,
      barId: ticket.barId,
      barName: ticket.bar.name,
      status: ticket.status,
      shortCode: ticket.shortCode,
      securityColor: ticket.securityColor,
      offlineQrToken: ticket.offlineQrJwt,
      shouldPrintImmediately: shouldPrintNow,
      items: ticket.items.map((i) => ({
        id: i.id,
        name: i.orderItem.product.name,
        quantity: i.quantity,
      })),
      activatedAt: ticket.activatedAt,
    };
  }

  /**
   * Avanza el estado de un ticket en el KDS (IN_PREPARATION -> READY_FOR_PICKUP -> DELIVERED)
   * Al liberarse capacidad, promueve el siguiente ticket en la cola FIFO de Redis.
   */
  async advanceTicketStatus(ticketId: string, nextStatus: TicketStatus) {
    const ticket = await this.prisma.pickupTicket.findUnique({
      where: { id: ticketId },
      include: { bar: true },
    });
    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} no encontrado.`);

    const now = new Date();
    const updateData: any = { status: nextStatus };
    if (nextStatus === TicketStatus.READY_FOR_PICKUP) updateData.readyAt = now;
    if (nextStatus === TicketStatus.DELIVERED) updateData.deliveredAt = now;

    const updated = await this.prisma.pickupTicket.update({
      where: { id: ticketId },
      data: updateData,
    });

    // Liberar turno de preparación en Redis cuando pasa a READY_FOR_PICKUP o DELIVERED
    if (nextStatus === TicketStatus.READY_FOR_PICKUP || nextStatus === TicketStatus.DELIVERED) {
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
          await this.prisma.pickupTicket.update({
            where: { id: nextTicketId },
            data: { status: TicketStatus.IN_PREPARATION },
          });
          console.log(`[Throttling] Ticket ${nextTicketId} promovido automáticamente a IN_PREPARATION por FIFO.`);
          return nextTicketId;
        }
      } catch (e) {
        console.warn('[Throttling] Error en promoción de cola:', e);
      }
    }
    return null;
  }

  /**
   * Valida un ticket escaneado (USB / Cámara) y previene fraude por re-canje (Anti-Replay)
   */
  async validateAndDeliverTicket(tokenOrShortCode: string) {
    let ticketId: string | null = null;

    // 1. Intentar decodificar como JWT offline nativo
    try {
      const decoded = this.verifyOfflineJwt(tokenOrShortCode);
      ticketId = decoded.ticketId;
    } catch {
      // Si no es JWT, buscar directamente por short_code
      const ticketByCode = await this.prisma.pickupTicket.findFirst({
        where: { shortCode: tokenOrShortCode.toUpperCase().trim() },
        orderBy: { activatedAt: 'desc' },
      });
      if (ticketByCode) ticketId = ticketByCode.id;
    }

    if (!ticketId) {
      throw new BadRequestException('Código o QR no reconocido.');
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

    // Protección Anti-Replay estricta: Si ya fue entregado, lanzar alerta roja
    if (ticket.status === TicketStatus.DELIVERED) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'TICKET_ALREADY_DELIVERED',
        message: '¡ALERTA DE SEGURIDAD! El ticket ya fue entregado previamente.',
        deliveredAt: ticket.deliveredAt,
      });
    }

    // Marcar como entregado y cerrar el ciclo
    return this.advanceTicketStatus(ticket.id, TicketStatus.DELIVERED);
  }

  async getTicketsByBar(barId: string) {
    return this.prisma.pickupTicket.findMany({
      where: {
        barId,
        status: { in: [TicketStatus.IN_PREPARATION, TicketStatus.READY_FOR_PICKUP, TicketStatus.PREP_REQUESTED] },
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
