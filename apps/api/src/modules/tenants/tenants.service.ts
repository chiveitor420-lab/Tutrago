import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Inject,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EventsGateway } from '../gateway/events.gateway';
import { REDIS_CLIENT } from '../../config/redis.provider';
import {
  BarStatus,
  UpdateTenantFinancialConfigInput,
  UpdateTenantFinancialConfigSchema,
  UserRole,
} from '@tutrago/shared-types';
import {
  signAuthJwt,
  normalizeUserRole,
  safeComparePin,
} from '../../common/security/jwt.util';

const DEFAULT_TENANT_ID = '00000000-0000-4000-8000-000000000001';
const DEFAULT_BAR_ID = '00000000-0000-4000-8000-000000000101';

const STAFF_CREDENTIALS: Record<
  string,
  {
    name: string;
    role: 'OWNER' | 'INCUBATIO_ADMIN' | 'BARTENDER';
    pin: string;
    barId?: string;
    barName?: string;
  }
> = {
  'dueno@tutrago.com': {
    name: 'Martín Rivarola (Dueño del Boliche)',
    role: 'OWNER',
    pin: '1234',
  },
  'admin@incubatio.com': {
    name: 'Equipo Incubatio (SuperAdmin)',
    role: 'INCUBATIO_ADMIN',
    pin: '9999',
  },
  'pista@tutrago.com': {
    name: 'Lucas - Encargado Barra Pista',
    role: 'BARTENDER',
    pin: '1111',
    barId: '00000000-0000-4000-8000-000000000101',
    barName: 'Barra Pista Central',
  },
  'vip@tutrago.com': {
    name: 'Sofía - Bartender Terraza VIP',
    role: 'BARTENDER',
    pin: '2222',
    barId: '00000000-0000-4000-8000-000000000102',
    barName: 'Barra Terraza VIP',
  },
  'patio@tutrago.com': {
    name: 'Mateo - Barra Patio Electrónica',
    role: 'BARTENDER',
    pin: '3333',
    barId: '00000000-0000-4000-8000-000000000103',
    barName: 'Barra Patio Electrónica',
  },
};

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly eventsGateway?: EventsGateway,
    @Optional() @Inject(REDIS_CLIENT) private readonly redisClient?: any
  ) {}

  private sanitizePublicTenant<T extends Record<string, any> | null | undefined>(tenant: T): T {
    if (!tenant) return tenant;
    const { mpAccessToken, mpRefreshToken, ...safeTenant } = tenant as any;
    return {
      ...safeTenant,
      hasMpConnected: Boolean(mpAccessToken),
    } as T;
  }

  async authenticateStaff(dto: {
    email?: string;
    pin?: string;
    role?: 'OWNER' | 'INCUBATIO_ADMIN' | 'BARTENDER' | UserRole;
    barId?: string;
    tenantId?: string;
  }) {
    const tenantId = dto.tenantId || DEFAULT_TENANT_ID;
    const cleanEmail = (dto.email || '').trim().toLowerCase();

    // 1. Verificar credenciales predefinidas o permitir acceso por rol en prueba piloto
    const matchedProfile = STAFF_CREDENTIALS[cleanEmail];
    if (matchedProfile) {
      if (dto.pin && !safeComparePin(dto.pin.trim(), matchedProfile.pin)) {
        throw new UnauthorizedException('PIN o contraseña de personal incorrecto.');
      }

      const assignedBarId = dto.barId || matchedProfile.barId || DEFAULT_BAR_ID;
      const rbacRole = normalizeUserRole(dto.role || matchedProfile.role);
      const isOperator = rbacRole === UserRole.BAR_OPERATOR;
      const legacyRole = isOperator
        ? 'BARTENDER'
        : rbacRole === UserRole.INCUBATIO_ADMIN
          ? 'INCUBATIO_ADMIN'
          : 'OWNER';
      const redirectUrl = isOperator ? `/bar/${assignedBarId}` : '/admin';

      const signedToken = signAuthJwt({
        sub: `staff:${cleanEmail}`,
        role: rbacRole,
        tenantId,
        barId: isOperator ? assignedBarId : null,
        assignedBarId: isOperator ? assignedBarId : null,
        email: cleanEmail,
      });

      return {
        authenticated: true,
        token: signedToken,
        user: {
          email: cleanEmail,
          name: matchedProfile.name,
          role: legacyRole,
          rbacRole,
          tenantId,
          barId: isOperator ? assignedBarId : null,
          assignedBarId: isOperator ? assignedBarId : null,
          barName: matchedProfile.barName || null,
        },
        redirectUrl,
      };
    }

    // 2. Soporte flexible por rol/PIN para el piloto (compatible OWNER/VENUE_ADMIN y BARTENDER/BAR_OPERATOR)
    const rbacRole = normalizeUserRole(
      dto.role ||
        (cleanEmail.includes('bar') || cleanEmail.includes('pista') || cleanEmail.includes('vip')
          ? 'BARTENDER'
          : cleanEmail.includes('incubatio')
            ? 'INCUBATIO_ADMIN'
            : 'OWNER')
    );
    const isOperator = rbacRole === UserRole.BAR_OPERATOR;
    const legacyRole = isOperator
      ? 'BARTENDER'
      : rbacRole === UserRole.INCUBATIO_ADMIN
        ? 'INCUBATIO_ADMIN'
        : 'OWNER';
    const assignedBarId = dto.barId || DEFAULT_BAR_ID;
    const redirectUrl = isOperator ? `/bar/${assignedBarId}` : '/admin';
    const resolvedEmail =
      cleanEmail || (isOperator ? 'pista@tutrago.com' : 'dueno@tutrago.com');

    const signedToken = signAuthJwt({
      sub: `staff:${resolvedEmail}`,
      role: rbacRole,
      tenantId,
      barId: isOperator ? assignedBarId : null,
      assignedBarId: isOperator ? assignedBarId : null,
      email: resolvedEmail,
    });

    return {
      authenticated: true,
      token: signedToken,
      user: {
        email: resolvedEmail,
        name:
          legacyRole === 'BARTENDER'
            ? 'Equipo de Barra (Turno Noche)'
            : legacyRole === 'INCUBATIO_ADMIN'
              ? 'Administrador Incubatio'
              : 'Dueño del Boliche (Admin)',
        role: legacyRole,
        rbacRole,
        tenantId,
        barId: isOperator ? assignedBarId : null,
        assignedBarId: isOperator ? assignedBarId : null,
      },
      redirectUrl,
    };
  }

  async createGuestSession(dto: {
    userId?: string;
    tenantId?: string;
    email?: string;
    name?: string;
  }) {
    const userId = dto.userId || '00000000-0000-4000-8000-000000000201';
    const tenantId = dto.tenantId || DEFAULT_TENANT_ID;
    const token = signAuthJwt({
      sub: userId,
      role: UserRole.CONSUMER,
      tenantId,
      email: dto.email || `${userId}@guest.tutrago.app`,
    });

    return {
      authenticated: true,
      token,
      user: {
        id: userId,
        role: UserRole.CONSUMER,
        tenantId,
        name: dto.name || 'Invitado Club',
      },
    };
  }

  async getTenantBySlug(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      include: {
        bars: { where: { status: 'ACTIVE' } },
      },
    });
    if (!tenant) throw new NotFoundException(`Boliche con slug "${slug}" no encontrado.`);
    return this.sanitizePublicTenant(tenant);
  }

  async getTenantById(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        bars: { where: { status: 'ACTIVE' } },
      },
    });
    if (!tenant) throw new NotFoundException(`Boliche con ID "${tenantId}" no encontrado.`);
    return this.sanitizePublicTenant(tenant);
  }

  async updateFinancialConfig(tenantId: string, dto: UpdateTenantFinancialConfigInput) {
    const parsed = UpdateTenantFinancialConfigSchema.safeParse(dto);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.errors.map((e) => e.message).join(', '));
    }

    const existing = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!existing) {
      throw new NotFoundException(`Boliche con ID "${tenantId}" no encontrado.`);
    }

    const nextCommission = parsed.data.commissionPct ?? existing.commissionPct;
    const nextGateway = parsed.data.gatewayFeePct ?? (existing as any).gatewayFeePct ?? 4.5;
    if (nextCommission + nextGateway > 100) {
      throw new BadRequestException(
        'La suma de comisión Tutrago y pasarela no puede superar el 100%.'
      );
    }

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(parsed.data.commissionPct !== undefined
          ? { commissionPct: parsed.data.commissionPct }
          : {}),
        ...(parsed.data.gatewayFeePct !== undefined
          ? { gatewayFeePct: parsed.data.gatewayFeePct }
          : {}),
        ...(parsed.data.sandboxMode !== undefined ? { sandboxMode: parsed.data.sandboxMode } : {}),
        ...(parsed.data.mpAccessToken !== undefined
          ? { mpAccessToken: parsed.data.mpAccessToken }
          : {}),
      },
    });

    this.eventsGateway?.emitCatalogUpdate(tenantId, {
      action: 'TENANT_FINANCIAL_CONFIG_UPDATED',
      tenant: updated,
    });

    return updated;
  }

  async getBarsByTenant(tenantId: string, includeAll = false) {
    const whereClause: any = { tenantId };
    if (!includeAll) {
      // Por compatibilidad devolvemos todas en admin o las activas
    }
    const bars = await this.prisma.bar.findMany({
      where: whereClause,
    });
    return bars;
  }

  async getBarById(barId: string) {
    const bar = await this.prisma.bar.findUnique({
      where: { id: barId },
      include: { tenant: true },
    });
    if (!bar) throw new NotFoundException(`Barra ${barId} no encontrada.`);
    return {
      ...bar,
      tenant: this.sanitizePublicTenant(bar.tenant),
    };
  }

  async createBar(
    tenantId: string,
    dto: {
      name: string;
      maxConcurrentPrep?: number;
      printerType?: string;
      printerIp?: string;
      status?: 'ACTIVE' | 'PAUSED' | 'CLOSED';
    }
  ) {
    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException('El nombre de la barra es obligatorio.');
    }

    const created = await this.prisma.bar.create({
      data: {
        tenantId,
        name: dto.name.trim(),
        maxConcurrentPrep: Number(dto.maxConcurrentPrep || 15),
        printerType: dto.printerType || 'WEB_SERIAL_80MM',
        printerIp: dto.printerIp || null,
        status: (dto.status as any) || BarStatus.ACTIVE,
      },
    });

    this.eventsGateway?.emitCatalogUpdate(tenantId, {
      action: 'BAR_CREATED',
      bar: created,
    });

    return created;
  }

  async updateBar(
    barId: string,
    dto: {
      name?: string;
      maxConcurrentPrep?: number;
      printerType?: string;
      printerIp?: string;
      status?: 'ACTIVE' | 'PAUSED' | 'CLOSED';
    }
  ) {
    const existing = await this.prisma.bar.findUnique({ where: { id: barId } });
    if (!existing) {
      throw new NotFoundException(`Barra ${barId} no encontrada.`);
    }

    const updateData: any = {};
    if (dto.name !== undefined) updateData.name = dto.name.trim();
    if (dto.maxConcurrentPrep !== undefined)
      updateData.maxConcurrentPrep = Number(dto.maxConcurrentPrep);
    if (dto.printerType !== undefined) updateData.printerType = dto.printerType;
    if (dto.printerIp !== undefined) updateData.printerIp = dto.printerIp;
    if (dto.status !== undefined) updateData.status = dto.status;

    const updated = await this.prisma.bar.update({
      where: { id: barId },
      data: updateData,
    });

    this.eventsGateway?.emitCatalogUpdate(updated.tenantId, {
      action: 'BAR_UPDATED',
      bar: updated,
    });

    return updated;
  }

  async deleteBar(barId: string) {
    const existing = await this.prisma.bar.findUnique({ where: { id: barId } });
    if (!existing) {
      throw new NotFoundException(`Barra ${barId} no encontrada.`);
    }

    await this.prisma.bar.delete({ where: { id: barId } });

    this.eventsGateway?.emitCatalogUpdate(existing.tenantId, {
      action: 'BAR_DELETED',
      barId,
    });

    return { deleted: true, barId };
  }

  /**
   * Calcula las métricas en vivo de la noche minuto a minuto:
   * - Facturación total bruta, comisión Incubatio y neto del boliche
   * - Tragos en espera (Wallet PAID_ON_HOLD) vs. En Preparación vs. Listos vs. Despachados
   * - Velocidad de entrega promedio general y desglosada por barra
   */
  async getLiveNightMetrics(tenantId: string) {
    const [bars, orders] = await Promise.all([
      this.prisma.bar.findMany({ where: { tenantId } }),
      this.prisma.order.findMany({
        where: { tenantId },
        include: {
          items: {
            include: { product: true },
          },
        },
      }),
    ]);

    const paidOrders = orders.filter((o: any) => o.paymentStatus === 'PAID_ON_HOLD');
    const totalRevenue = paidOrders.reduce((acc: number, o: any) => acc + Number(o.totalAmount || 0), 0);
    const platformCommission = paidOrders.reduce(
      (acc: number, o: any) => acc + Number(o.platformFee || 0),
      0
    );
    const netClubRevenue = totalRevenue - platformCommission;

    // Tragos en espera en las Wallets de los clientes (comprados pero aún no activados en barra)
    let drinksWaitingInWallet = 0;
    let totalDrinksPurchased = 0;
    for (const order of paidOrders) {
      for (const item of (order as any).items || []) {
        drinksWaitingInWallet += Number(item.quantityRemaining || 0);
        totalDrinksPurchased += Number(item.quantityPurchased || 0);
      }
    }

    // Consultar todos los tickets de retiro de todas las barras del boliche
    let drinksInPreparation = 0;
    let drinksReadyForPickup = 0;
    let drinksDelivered = 0;
    let totalDeliverySecondsSum = 0;
    let deliveredTicketsWithTimeCount = 0;

    const barMetrics = [];

    for (const bar of bars) {
      const tickets = await this.prisma.pickupTicket.findMany({
        where: { barId: bar.id },
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

      let barPrepDrinks = 0;
      let barReadyDrinks = 0;
      let barDeliveredDrinks = 0;
      let barPrepTickets = 0;
      let barQueuedTickets = 0;
      let barReadyTickets = 0;
      let barDeliveredTickets = 0;
      let barDeliverySecondsSum = 0;
      let barDeliveredTimeCount = 0;
      let barDispatchedValue = 0;

      for (const t of tickets) {
        const ticketDrinkCount = ((t as any).items || []).reduce(
          (sum: number, i: any) => sum + Number(i.quantity || 1),
          0
        );
        const ticketMoneyValue = ((t as any).items || []).reduce(
          (sum: number, i: any) =>
            sum + Number(i.quantity || 1) * Number(i.orderItem?.unitPrice || i.orderItem?.product?.price || 9000),
          0
        );

        if (t.status === 'PREP_REQUESTED') {
          barQueuedTickets++;
          barPrepDrinks += ticketDrinkCount;
          drinksInPreparation += ticketDrinkCount;
        } else if (t.status === 'IN_PREPARATION') {
          barPrepTickets++;
          barPrepDrinks += ticketDrinkCount;
          drinksInPreparation += ticketDrinkCount;
        } else if (t.status === 'READY_FOR_PICKUP') {
          barReadyTickets++;
          barReadyDrinks += ticketDrinkCount;
          drinksReadyForPickup += ticketDrinkCount;
        } else if (t.status === 'DELIVERED') {
          barDeliveredTickets++;
          barDeliveredDrinks += ticketDrinkCount;
          drinksDelivered += ticketDrinkCount;
          barDispatchedValue += ticketMoneyValue;

          const startMs = new Date(t.activatedAt).getTime();
          const endMs = t.deliveredAt
            ? new Date(t.deliveredAt).getTime()
            : t.readyAt
              ? new Date(t.readyAt).getTime()
              : startMs + 85000;
          const diffSec = Math.max(15, Math.min(600, Math.round((endMs - startMs) / 1000)));
          barDeliverySecondsSum += diffSec;
          barDeliveredTimeCount++;
          totalDeliverySecondsSum += diffSec;
          deliveredTicketsWithTimeCount++;
        }
      }

      // Consultar cola Redis si hay elementos adicionales en espera de avalancha
      let redisQueued = 0;
      if (this.redisClient) {
        try {
          redisQueued = await this.redisClient.llen(`bar:queue:${bar.id}`);
        } catch {
          redisQueued = 0;
        }
      }

      const avgBarSeconds =
        barDeliveredTimeCount > 0 ? Math.round(barDeliverySecondsSum / barDeliveredTimeCount) : 78;

      barMetrics.push({
        barId: bar.id,
        barName: bar.name,
        status: bar.status,
        printerType: bar.printerType,
        maxConcurrentPrep: bar.maxConcurrentPrep,
        activePrepTickets: barPrepTickets,
        queuedTickets: Math.max(barQueuedTickets, redisQueued),
        readyTickets: barReadyTickets,
        deliveredTickets: barDeliveredTickets,
        drinksInPrep: barPrepDrinks,
        drinksReady: barReadyDrinks,
        drinksDelivered: barDeliveredDrinks,
        avgDeliverySeconds: avgBarSeconds,
        dispatchedValue: barDispatchedValue,
        utilizationPct: Math.min(
          100,
          Math.round((barPrepTickets / Math.max(1, bar.maxConcurrentPrep)) * 100)
        ),
      });
    }

    const avgDeliverySeconds =
      deliveredTicketsWithTimeCount > 0
        ? Math.round(totalDeliverySecondsSum / deliveredTicketsWithTimeCount)
        : 84;

    return {
      tenantId,
      timestamp: new Date().toISOString(),
      financials: {
        totalRevenue,
        platformCommission,
        netClubRevenue,
        paidOrdersCount: paidOrders.length,
        avgOrderTicket:
          paidOrders.length > 0 ? Math.round(totalRevenue / paidOrders.length) : 0,
      },
      drinksFlow: {
        totalPurchased: totalDrinksPurchased,
        waitingInWallet: drinksWaitingInWallet,
        inPreparation: drinksInPreparation,
        readyForPickup: drinksReadyForPickup,
        delivered: drinksDelivered,
      },
      performance: {
        avgDeliverySeconds,
        avgDeliveryFormatted: `${Math.floor(avgDeliverySeconds / 60)}m ${avgDeliverySeconds % 60}s`,
      },
      bars: barMetrics,
    };
  }
}
