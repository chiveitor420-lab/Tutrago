import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PickupService } from '../../src/modules/pickup/pickup.service';
import { IdempotencyInterceptor } from '../../src/common/interceptors/idempotency.interceptor';
import { TicketStatus } from '@tutrago/shared-types';
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
      async set(key: string, val: string) {
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
            header: () => {},
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
});
