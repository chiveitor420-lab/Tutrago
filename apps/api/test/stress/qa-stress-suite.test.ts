import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PickupService } from '../../src/modules/pickup/pickup.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { TenantsService } from '../../src/modules/tenants/tenants.service';
import { IdempotencyInterceptor } from '../../src/common/interceptors/idempotency.interceptor';
import {
  TicketStatus,
  OrderStatus,
  UserRole,
  calculateOrderFinancials,
} from '@tutrago/shared-types';
import { of } from 'rxjs';

describe('SOP 05: Suite de QA, Resiliencia y Pruebas de Estrés (2:30 AM en Boliche)', () => {
  const createMocks = () => {
    const mockRedis = {
      store: new Map<string, string>(),
      lists: new Map<string, string[]>(),
      sets: new Map<string, Set<string>>(),
      async get(key: string) {
        return this.store.get(key) || null;
      },
      async set(key: string, val: string, ...args: any[]) {
        const isNx = args.some((a) => String(a).toUpperCase() === 'NX');
        if (isNx && this.store.has(key)) {
          return null;
        }
        this.store.set(key, val);
        return 'OK';
      },
      async del(key: string) {
        this.store.delete(key);
        return 1;
      },
      async scard(key: string) {
        return this.sets.get(key)?.size || 0;
      },
      async sadd(key: string, member: string) {
        if (!this.sets.has(key)) this.sets.set(key, new Set());
        this.sets.get(key)!.add(member);
        return 1;
      },
      async rpush(key: string, member: string) {
        if (!this.lists.has(key)) this.lists.set(key, []);
        this.lists.get(key)!.push(member);
        return this.lists.get(key)!.length;
      },
      async lpop(key: string) {
        const list = this.lists.get(key);
        if (!list || list.length === 0) return null;
        return list.shift();
      },
    };

    const mockPrisma: any = {
      bar: {
        findUnique: async () => ({
          id: 'bar-pista-123',
          name: 'Barra Pista Central',
          maxConcurrentPrep: 15,
        }),
      },
      pickupTicket: {
        create: async ({ data }: any) => ({
          id: `ticket-${Math.random().toString(36).substring(7)}`,
          status: data.status,
          shortCode: data.shortCode,
          securityColor: data.securityColor,
          offlineQrJwt: '',
          barId: data.barId,
          orderId: data.orderId,
          activatedAt: new Date(),
        }),
        update: async ({ where, data }: any) => ({
          id: where.id,
          ...data,
          bar: { id: 'bar-pista-123', name: 'Barra Pista Central' },
          items: [
            {
              id: 'item-1',
              quantity: 1,
              orderItem: { product: { name: 'Fernet Branca' } },
            },
          ],
        }),
        findFirst: async ({ where }: any) => {
          if (where.shortCode === 'DELIVERED-CODE') {
            return {
              id: 'ticket-delivered-already',
              status: TicketStatus.DELIVERED,
              deliveredAt: new Date(),
              items: [],
            };
          }
          return null;
        },
        findUnique: async ({ where }: any) => {
          if (where.id === 'ticket-delivered-already') {
            return {
              id: 'ticket-delivered-already',
              status: TicketStatus.DELIVERED,
              deliveredAt: new Date(),
              items: [],
            };
          }
          return {
            id: where.id,
            status: TicketStatus.READY_FOR_PICKUP,
            shortCode: 'A47',
            securityColor: '#EF4444',
            barId: 'bar-pista-123',
            bar: { id: 'bar-pista-123', name: 'Barra Pista Central' },
            items: [],
          };
        },
      },
      product: {
        findUnique: async () => ({
          id: 'prod-1',
          name: 'Fernet Branca',
          isAvailable: true,
          price: 9500,
        }),
      },
      orderItem: {
        update: async () => ({}),
      },
      $transaction: async (callback: any) => {
        return callback({
          $queryRaw: async () => [
            {
              id: 'order-item-fernet',
              order_id: 'order-123',
              product_id: 'prod-1',
              quantity_remaining: 1,
            },
          ],
          product: mockPrisma.product,
          orderItem: mockPrisma.orderItem,
          pickupTicket: mockPrisma.pickupTicket,
        });
      },
    };

    const service = new PickupService(mockPrisma, mockRedis as any);
    return { service, mockPrisma, mockRedis };
  };

  describe('1. Test de Condición de Carrera (Race Condition en Canje)', () => {
    it('debe permitir canjear exactamente 1 trago cuando quantity_remaining = 1 y bloquear 9 peticiones concurrentes', async () => {
      const { service, mockPrisma } = createMocks();
      let remainingBalance = 1;

      mockPrisma.$transaction = async () => {
        if (remainingBalance < 1) {
          throw new Error('Saldo insuficiente para canjear este trago.');
        }
        remainingBalance -= 1;
        return {
          ticket: {
            id: 'ticket-race-win',
            shortCode: 'B12',
            securityColor: '#10B981',
            status: TicketStatus.IN_PREPARATION,
            bar: { name: 'Barra Pista Central' },
            items: [{ id: '1', orderItem: { product: { name: 'Fernet Branca' } }, quantity: 1 }],
          },
        };
      };

      const promises = Array.from({ length: 10 }).map(() =>
        service.requestPickup({
          userId: 'user-night-1',
          barId: 'bar-pista-123',
          items: [{ orderItemId: 'order-item-fernet', quantityToRedeem: 1 }],
        })
      );

      const results = await Promise.allSettled(promises);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      assert.equal(fulfilled.length, 1, 'Exactamente 1 petición debe tener éxito');
      assert.equal(rejected.length, 9, 'Las 9 peticiones concurrentes restantes deben ser bloqueadas');
      assert.equal(remainingBalance, 0, 'El saldo restante debe ser 0');
    });
  });

  describe('2. Test de Idempotencia en Red Inestable (X-Idempotency-Key)', () => {
    it('debe devolver respuesta cacheada sin duplicar ejecuciones ante reintentos de 4G', async () => {
      const { mockRedis } = createMocks();
      const interceptor = new IdempotencyInterceptor(mockRedis as any);
      let executionCount = 0;

      const mockCallHandler = {
        handle: () => {
          executionCount++;
          return of({ success: true, ticketId: 'ticket-idem-99' });
        },
      };

      const createMockContext = (key: string) => ({
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'POST',
            headers: { 'x-idempotency-key': key },
          }),
          getResponse: () => ({
            header: () => { },
          }),
        }),
      });

      const key = 'uuid-retry-test-123';

      // 1ra petición
      const firstObs = await interceptor.intercept(createMockContext(key) as any, mockCallHandler);
      let res1: any;
      firstObs.subscribe((val) => (res1 = val));

      // 2da y 3ra peticiones con la misma clave
      const secondObs = await interceptor.intercept(createMockContext(key) as any, mockCallHandler);
      let res2: any;
      secondObs.subscribe((val) => (res2 = val));

      assert.equal(executionCount, 1, 'El endpoint solo debe ejecutarse 1 sola vez');
      assert.deepEqual(res1, res2, 'Las respuestas deben ser idénticas');
    });
  });

  describe('3. Test de Avalancha en Barra (Throttling FIFO con max_concurrent_prep = 15)', () => {
    it('debe enviar exactamente 15 tickets a IN_PREPARATION y encolar 65 en la cola FIFO de Redis', async () => {
      const { service, mockRedis } = createMocks();
      const barId = 'bar-pista-123';
      const maxConcurrent = 15;
      const totalUsers = 80;

      for (let i = 0; i < totalUsers; i++) {
        await service.requestPickup({
          userId: `user-${i}`,
          barId,
          items: [{ orderItemId: 'order-item-fernet', quantityToRedeem: 1 }],
        });
      }

      const activeSet = mockRedis.sets.get(`bar:active:${barId}`);
      const queueList = mockRedis.lists.get(`bar:queue:${barId}`);

      assert.equal(activeSet?.size, maxConcurrent, 'Deben existir exactamente 15 tickets en preparación');
      assert.equal(queueList?.length, totalUsers - maxConcurrent, 'Deben existir 65 tickets en cola FIFO');
    });
  });

  describe('4. Test de Validación Offline y Anti-Replay', () => {
    it('debe rechazar con ALERTA ROJA si un ticket ya fue marcado como DELIVERED', async () => {
      const { service } = createMocks();

      await assert.rejects(
        async () => {
          await service.validateAndDeliverTicket('DELIVERED-CODE');
        },
        (err: any) => {
          assert.match(err.message, /ALERTA DE SEGURIDAD/);
          return true;
        }
      );
    });
  });

  describe('5. Motor Financiero: Aritmética Decimal Exacta, Split Payment y Webhook E2E a PAID_ON_HOLD', () => {
    const createFinancialStatefulEnv = () => {
      const db = {
        tenants: new Map<string, any>([
          [
            '00000000-0000-4000-8000-000000000001',
            {
              id: '00000000-0000-4000-8000-000000000001',
              name: 'Club Nocturno Tutrago Central',
              slug: 'club-tutrago',
              commissionPct: 12.5, // Configurable por Tenant
              gatewayFeePct: 4.5,  // Costo pasarela configurable
              sandboxMode: true,
              mpAccessToken: 'TEST-ACCESS-TOKEN-TUTRAGO-BOLICHE',
            },
          ],
        ]),
        users: new Map<string, any>(),
        products: new Map<string, any>([
          [
            '00000000-0000-4000-8000-000000000501',
            {
              id: '00000000-0000-4000-8000-000000000501',
              tenantId: '00000000-0000-4000-8000-000000000001',
              name: 'Fernet Branca con Coca-Cola',
              category: 'Tragos Clásicos',
              price: 9500,
              isAvailable: true,
              upsells: [
                {
                  id: '00000000-0000-4000-8000-000000000601',
                  title: 'Medida Doble de Fernet',
                  additionalPrice: 4000,
                },
              ],
            },
          ],
          [
            '00000000-0000-4000-8000-000000000502',
            {
              id: '00000000-0000-4000-8000-000000000502',
              tenantId: '00000000-0000-4000-8000-000000000001',
              name: 'Gin Tonic Nacional',
              category: 'Gin & Cocktails',
              price: 8500,
              isAvailable: true,
              upsells: [],
            },
          ],
        ]),
        orders: new Map<string, any>(),
        orderItems: new Map<string, any>(),
        wsEvents: [] as any[],
      };

      const prismaMock: any = {
        tenant: {
          findUnique: async ({ where }: any) => {
            if (where.id) return db.tenants.get(where.id) || null;
            for (const t of db.tenants.values()) {
              if (t.slug === where.slug) return t;
            }
            return null;
          },
          update: async ({ where, data }: any) => {
            const existing = db.tenants.get(where.id);
            const updated = { ...existing, ...data };
            db.tenants.set(where.id, updated);
            return updated;
          },
        },
        user: {
          findUnique: async ({ where }: any) => db.users.get(where.id) || null,
          create: async ({ data }: any) => {
            db.users.set(data.id, data);
            return data;
          },
        },
        product: {
          findUnique: async ({ where }: any) => db.products.get(where.id) || null,
        },
        order: {
          create: async ({ data }: any) => {
            const orderId = '00000000-0000-4000-8000-000000000999';
            const createdItems = (data.items?.create || []).map((item: any, idx: number) => {
              const itemId = `00000000-0000-4000-8000-00000000080${idx + 1}`;
              const product = db.products.get(item.productId);
              const fullItem = {
                id: itemId,
                orderId,
                ...item,
                createdAt: new Date(),
                updatedAt: new Date(),
                product: {
                  ...product,
                  tenant: db.tenants.get(data.tenantId),
                },
              };
              db.orderItems.set(itemId, fullItem);
              return fullItem;
            });

            const orderObj = {
              id: orderId,
              userId: data.userId,
              tenantId: data.tenantId,
              totalAmount: data.totalAmount,
              platformFee: data.platformFee,
              gatewayFee: data.gatewayFee,
              tenantNetAmount: data.tenantNetAmount,
              appliedCommissionPct: data.appliedCommissionPct,
              appliedGatewayFeePct: data.appliedGatewayFeePct,
              paymentStatus: data.paymentStatus,
              mpPreferenceId: null,
              mpPaymentId: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              items: createdItems,
              tenant: db.tenants.get(data.tenantId),
            };
            db.orders.set(orderId, orderObj);
            return orderObj;
          },
          findUnique: async ({ where }: any) => {
            const o = db.orders.get(where.id);
            if (!o) return null;
            const items = Array.from(db.orderItems.values()).filter((i) => i.orderId === o.id);
            return {
              ...o,
              items,
              tenant: db.tenants.get(o.tenantId),
            };
          },
          update: async ({ where, data }: any) => {
            const o = db.orders.get(where.id);
            const updated = { ...o, ...data, updatedAt: new Date() };
            db.orders.set(where.id, updated);
            return updated;
          },
        },
        orderItem: {
          update: async ({ where, data }: any) => {
            const item = db.orderItems.get(where.id);
            const updated = { ...item, ...data, updatedAt: new Date() };
            db.orderItems.set(where.id, updated);
            return updated;
          },
          findMany: async ({ where }: any) => {
            return Array.from(db.orderItems.values())
              .filter((item) => {
                const order = db.orders.get(item.orderId);
                return (
                  order &&
                  order.userId === where.order.userId &&
                  order.paymentStatus === where.order.paymentStatus &&
                  item.quantityRemaining > where.quantityRemaining.gt
                );
              })
              .map((item) => ({
                ...item,
                order: db.orders.get(item.orderId),
              }));
          },
        },
        $transaction: async (cb: any) => cb(prismaMock),
      };

      const gatewayMock: any = {
        emitOrderPaymentUpdate: (orderId: string, payload: any) => {
          db.wsEvents.push({ orderId, payload });
        },
      };

      const ordersService = new OrdersService(prismaMock);
      const paymentsService = new PaymentsService(prismaMock, gatewayMock);
      const tenantsService = new TenantsService(prismaMock);

      return { db, ordersService, paymentsService, tenantsService };
    };

    it('debe garantizar cuadratura contable exacta en centavos (Suma Cero) y soportar comisión 0% sin fallback erróneo', () => {
      // Caso 1: Montos con decimales propensos a errores IEEE 754 (ej. $33.33 x 3 con 12.75% y 4.65%)
      const breakdown = calculateOrderFinancials(
        [
          { productId: 'p1', basePrice: 33.33, quantity: 3 },
          { productId: 'p2', basePrice: 19.99, upsellPrice: 5.01, quantity: 2 },
        ],
        12.75,
        4.65
      );

      assert.equal(breakdown.totalAmount, 149.99, 'El total debe ser exactamente 149.99');
      const sumParts = Number(
        (breakdown.platformFee + breakdown.gatewayFee + breakdown.tenantNetAmount).toFixed(2)
      );
      assert.equal(
        sumParts,
        breakdown.totalAmount,
        'Invariante Suma Cero: platformFee + gatewayFee + tenantNetAmount === totalAmount'
      );

      // Verificar que la suma de los ítems coincida al centavo con el total de la orden
      const itemsPlatformSum = Number(
        breakdown.items.reduce((acc, i) => acc + i.itemPlatformFee, 0).toFixed(2)
      );
      const itemsGatewaySum = Number(
        breakdown.items.reduce((acc, i) => acc + i.itemGatewayFee, 0).toFixed(2)
      );
      const itemsNetSum = Number(
        breakdown.items.reduce((acc, i) => acc + i.itemTenantNet, 0).toFixed(2)
      );

      assert.equal(itemsPlatformSum, breakdown.platformFee, 'Suma de comisión por bebida === comisión de la orden');
      assert.equal(itemsGatewaySum, breakdown.gatewayFee, 'Suma de pasarela por bebida === pasarela de la orden');
      assert.equal(itemsNetSum, breakdown.tenantNetAmount, 'Suma neta por bebida === neto boliche de la orden');

      // Caso 2: Comisión 0% (noche piloto bonificada) NO debe sobreescribirse a 10%
      const zeroComm = calculateOrderFinancials(
        [{ productId: 'p1', basePrice: 10000, quantity: 1 }],
        0,
        4.5
      );
      assert.equal(zeroComm.platformFee, 0, 'Con comisión 0%, platformFee debe ser 0');
      assert.equal(zeroComm.gatewayFee, 450, 'Con pasarela 4.5%, gatewayFee debe ser 450');
      assert.equal(zeroComm.tenantNetAmount, 9550, 'El neto del boliche debe ser 9550');
    });

    it('debe completar el flujo E2E desde Checkout -> Preferencia Split Payment -> Webhook HMAC -> PAID_ON_HOLD y habilitar los vales en la Wallet', async () => {
      const { ordersService, paymentsService, tenantsService, db } = createFinancialStatefulEnv();
      const tenantId = '00000000-0000-4000-8000-000000000001';
      const userId = '00000000-0000-4000-8000-000000000901';

      // 1. Configurar el porcentaje del boliche dinámicamente desde DB (12% Tutrago, 4.5% Pasarela)
      await tenantsService.updateFinancialConfig(tenantId, {
        commissionPct: 12.0,
        gatewayFeePct: 4.5,
        sandboxMode: true,
      });

      // 2. Checkout: Crear orden con 2 Fernet Dobles ($9500 + $4000 = $13500 c/u -> $27000) + 1 Gin ($8500) = $35500
      const order = await ordersService.createOrder({
        tenantId,
        userId,
        items: [
          {
            productId: '00000000-0000-4000-8000-000000000501',
            quantity: 2,
            selectedUpsellId: '00000000-0000-4000-8000-000000000601',
          },
          {
            productId: '00000000-0000-4000-8000-000000000502',
            quantity: 1,
          },
        ],
      });

      assert.equal(order.paymentStatus, OrderStatus.CREATED);
      assert.equal(order.totalAmount, 35500, 'Total bruto debe ser $35.500');
      assert.equal(order.platformFee, 4260, 'Comisión Tutrago (12%) debe ser $4.260');
      assert.equal(order.gatewayFee, 1597.5, 'Costo pasarela MP (4.5%) debe ser $1.597,50');
      assert.equal(order.tenantNetAmount, 29642.5, 'Monto neto líquido boliche debe ser $29.642,50');

      // Antes del pago la Wallet debe estar vacía
      const walletBefore = await ordersService.getUserWallet(userId);
      assert.equal(walletBefore.length, 0, 'No deben existir vales habilitados antes del pago');

      // 3. Generar preferencia de Split Payment y Deep Link a Mercado Pago
      const pref = await paymentsService.createPaymentPreference(order.id);
      assert.equal(pref.payload.marketplace_fee, 4260, 'marketplace_fee enviado a MP debe ser exactamente $4.260');
      assert.match(pref.deepLinkUrl, /^mercadopago:\/\/checkout\/v1\/redirect\?pref_id=/);

      // 4. Validar seguridad criptográfica del Webhook HMAC-SHA256
      process.env.MP_WEBHOOK_SECRET = 'tutrago_hmac_secret_test_2026';
      const paymentId = 'MP-LIVE-88776655';

      // Firma adulterada debe ser rechazada con UnauthorizedException
      await assert.rejects(
        async () => {
          await paymentsService.processPaymentWebhook(
            { data: { id: paymentId, external_reference: order.id } },
            'ts=1700000000,v1=invalid_hmac_signature'
          );
        },
        (err: any) => {
          assert.match(err.message, /Firma criptográfica de Webhook Mercado Pago inválida/);
          return true;
        }
      );

      // Firma HMAC legítima debe aprobar y acreditar atómicamente en PAID_ON_HOLD
      const validSignature = paymentsService.generateWebhookSignature(
        paymentId,
        process.env.MP_WEBHOOK_SECRET,
        '1700000000',
        'req-uuid-1'
      );

      const webhookResult = await paymentsService.processPaymentWebhook(
        { status: 'approved', data: { id: paymentId, external_reference: order.id } },
        validSignature,
        'req-uuid-1'
      );

      assert.equal(webhookResult.status, 'SUCCESS');
      assert.equal(webhookResult.order?.paymentStatus, OrderStatus.PAID_ON_HOLD);
      assert.equal(db.wsEvents.length, 1, 'Debe emitir notificación WebSocket instantánea al celular');

      // 5. Verificar que los vales estén acreditados en la Wallet del usuario
      const walletAfter = await ordersService.getUserWallet(userId);
      assert.equal(walletAfter.length, 2, 'Deben existir 2 líneas de bebidas en la Wallet');
      const totalVouchers = walletAfter.reduce((acc, w) => acc + w.quantityRemaining, 0);
      assert.equal(totalVouchers, 3, 'El usuario debe tener exactamente 3 tragos listos para canjear');

      // 6. Probar Simulador Piloto Autorizado: Rechazo de PIN inválido y Reembolso en tiempo real
      await assert.rejects(
        async () => {
          await paymentsService.simulatePilotAction({
            orderId: order.id,
            action: 'REFUND',
            pilotPin: '0000',
          });
        },
        (err: any) => {
          assert.match(err.message, /PIN de Simulador Piloto inválido/);
          return true;
        }
      );

      const refundRes = await paymentsService.simulatePilotAction({
        orderId: order.id,
        action: 'REFUND',
        pilotPin: '2026',
      });
      assert.equal(refundRes.status, 'REFUNDED');
      assert.equal(refundRes.order?.paymentStatus, OrderStatus.CANCELLED_REFUNDED);

      const walletAfterRefund = await ordersService.getUserWallet(userId);
      assert.equal(
        walletAfterRefund.length,
        0,
        'Tras un reembolso en tiempo real, los vales deben quedar revocados (0 disponibles)'
      );

      delete process.env.MP_WEBHOOK_SECRET;
    });
  });

  describe('6. Blindaje de Ciberseguridad: Anti-Doble Escaneo Concurrente, Anti-IDOR, Firma QR Timing-Safe y Modo Piloto en Producción', () => {
    it('debe bloquear 9 de 10 escaneos simultáneos del mismo QR en barra mediante bloqueo atómico Redis NX', async () => {
      const { service, mockPrisma } = createMocks();
      let ticketDelivered = false;

      mockPrisma.pickupTicket.findUnique = async ({ where }: any) => ({
        id: where.id,
        status: ticketDelivered ? TicketStatus.DELIVERED : TicketStatus.READY_FOR_PICKUP,
        shortCode: 'A47',
        securityColor: '#10B981',
        barId: 'bar-pista-123',
        bar: { id: 'bar-pista-123', name: 'Barra Pista Central' },
        items: [],
      });

      const originalUpdate = mockPrisma.pickupTicket.update;
      mockPrisma.pickupTicket.update = async (args: any) => {
        ticketDelivered = true;
        return originalUpdate(args);
      };

      const signedToken = service.signOfflineJwt({
        ticketId: 'ticket-concurrent-scan-1',
        shortCode: 'A47',
        barId: 'bar-pista-123',
        securityColor: '#10B981',
        items: [{ name: 'Fernet Branca', quantity: 1 }],
      });

      const scanAttempts = Array.from({ length: 10 }).map(() =>
        service.validateAndDeliverTicket(signedToken, 'bar-pista-123')
      );

      const results = await Promise.allSettled(scanAttempts);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      assert.equal(fulfilled.length, 1, 'Exactamente 1 escaneo debe entregar el trago');
      assert.equal(rejected.length, 9, 'Los 9 escaneos concurrentes restantes deben ser rechazados');
    });

    it('debe rechazar códigos QR con firma HMAC adulterada y bloquear el canje en una barra distinta a la asignada', async () => {
      const { service } = createMocks();
      const validToken = service.signOfflineJwt({
        ticketId: 'ticket-bar-check-1',
        shortCode: 'C88',
        barId: 'bar-pista-123',
        securityColor: '#3B82F6',
        items: [{ name: 'Gin Tonic', quantity: 1 }],
      });

      const tamperedToken = `${validToken.slice(0, -4)}ffff`;
      await assert.rejects(
        async () => {
          await service.validateAndDeliverTicket(tamperedToken, 'bar-pista-123');
        },
        (err: any) => {
          assert.match(err.message, /Firma criptográfica QR inválida/);
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await service.validateAndDeliverTicket(validToken, 'bar-terraza-vip-999');
        },
        (err: any) => {
          assert.match(err.message, /ALERTA DE BARRA|pertenece a otra barra/);
          return true;
        }
      );
    });

    it('debe impedir vulnerabilidad IDOR si un consumidor intenta activar vales de otro usuario', async () => {
      const { service, mockPrisma } = createMocks();
      mockPrisma.$transaction = async (cb: any) =>
        cb({
          $queryRaw: async () => [
            {
              id: 'order-item-victim',
              order_id: 'order-victim',
              product_id: 'prod-1',
              quantity_remaining: 2,
              user_id: 'user-victim-001',
              payment_status: 'PAID_ON_HOLD',
            },
          ],
          product: mockPrisma.product,
          orderItem: mockPrisma.orderItem,
          pickupTicket: mockPrisma.pickupTicket,
        });

      await assert.rejects(
        async () => {
          await service.requestPickup(
            {
              userId: 'user-attacker-999',
              barId: 'bar-pista-123',
              items: [{ orderItemId: 'order-item-victim', quantityToRedeem: 1 }],
            },
            {
              sub: 'user-attacker-999',
              role: UserRole.CONSUMER,
              iat: 1,
              exp: 9999999999,
            }
          );
        },
        (err: any) => {
          assert.match(err.message, /No tienes permisos para canjear bebidas/);
          return true;
        }
      );
    });

    it('debe exigir X-Pilot-Pin (timingSafeEqual) o rol Admin en simulatePaymentApproval cuando NODE_ENV=production', async () => {
      const env = process.env as Record<string, string | undefined>;
      const prevEnv = env.NODE_ENV;
      const prevSandboxPin = env.PILOT_SANDBOX_PIN;
      env.NODE_ENV = 'production';
      env.PILOT_SANDBOX_PIN = '837a176812e4565575ad2d91f335540e';

      const mockPayments = new PaymentsService({
        $transaction: async () => ({
          id: 'order-prod-pilot',
          userId: 'u1',
          tenantId: 't1',
          paymentStatus: OrderStatus.PAID_ON_HOLD,
          totalAmount: 9500,
          platformFee: 950,
        }),
      } as any);

      try {
        // Sin PIN ni rol admin en producción -> UnauthorizedException
        await assert.rejects(
          async () => {
            await mockPayments.simulatePaymentApproval('order-prod-pilot');
          },
          (err: any) => {
            assert.match(err.message, /Simulación en producción restringida/);
            return true;
          }
        );

        // Con X-Pilot-Pin válido -> Aprobado
        const okWithPin = await mockPayments.simulatePaymentApproval('order-prod-pilot', {
          pilotPin: '837a176812e4565575ad2d91f335540e',
        });
        assert.equal(okWithPin.status, 'SUCCESS');

        // Con JWT rol VENUE_ADMIN -> Aprobado
        const okWithAdmin = await mockPayments.simulatePaymentApproval('order-prod-pilot', {
          user: {
            sub: 'admin-1',
            role: UserRole.VENUE_ADMIN,
            iat: 1,
            exp: 9999999999,
          },
        });
        assert.equal(okWithAdmin.status, 'SUCCESS');
      } finally {
        if (prevEnv === undefined) {
          delete env.NODE_ENV;
        } else {
          env.NODE_ENV = prevEnv;
        }
        if (prevSandboxPin === undefined) {
          delete env.PILOT_SANDBOX_PIN;
        } else {
          env.PILOT_SANDBOX_PIN = prevSandboxPin;
        }
      }
    });
  });
});
