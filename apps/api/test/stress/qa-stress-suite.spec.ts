import { Test, TestingModule } from '@nestjs/testing';
import { PickupService } from '../../src/modules/pickup/pickup.service';
import { PrismaService } from '../../src/modules/database/prisma.service';
import { IdempotencyInterceptor } from '../../src/common/interceptors/idempotency.interceptor';
import { TicketStatus } from '@tutrago/shared-types';
import { of } from 'rxjs';

describe('SOP 05: Suite de QA, Resiliencia y Pruebas de Estrés (2:30 AM en Boliche)', () => {
  let pickupService: PickupService;
  let mockPrisma: any;
  let mockRedis: any;

  beforeEach(async () => {
    mockRedis = {
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

    mockPrisma = {
      bar: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'bar-pista-123',
          name: 'Barra Pista Central',
          maxConcurrentPrep: 15,
        }),
      },
      pickupTicket: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: `ticket-${Math.random().toString(36).substring(7)}`,
          status: data.status,
          shortCode: data.shortCode,
          securityColor: data.securityColor,
          offlineQrJwt: '',
          barId: data.barId,
          orderId: data.orderId,
          activatedAt: new Date(),
        })),
        update: jest.fn().mockImplementation(({ where, data }) => ({
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
        })),
        findUnique: jest.fn().mockResolvedValue({
          id: 'ticket-test-123',
          status: TicketStatus.READY_FOR_PICKUP,
          shortCode: 'A47',
          securityColor: '#EF4444',
          barId: 'bar-pista-123',
          bar: { id: 'bar-pista-123', name: 'Barra Pista Central' },
          items: [],
        }),
      },
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'prod-1',
          name: 'Fernet Branca',
          isAvailable: true,
          price: 9500,
        }),
      },
      orderItem: {
        update: jest.fn().mockResolvedValue({}),
      },
      // Simulación de transacción con bloqueo pesimista en memoria
      $transaction: jest.fn().mockImplementation(async (callback) => {
        return callback({
          $queryRaw: jest.fn().mockResolvedValue([
            {
              id: 'order-item-fernet',
              order_id: 'order-123',
              product_id: 'prod-1',
              quantity_remaining: 1, // Saldo inicial: solo 1 disponible
            },
          ]),
          product: mockPrisma.product,
          orderItem: mockPrisma.orderItem,
          pickupTicket: mockPrisma.pickupTicket,
        });
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PickupService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    pickupService = module.get<PickupService>(PickupService);
  });

  describe('1. Test de Condición de Carrera (Race Condition en Canje)', () => {
    it('debe permitir canjear exactamente 1 trago cuando quantity_remaining = 1 y bloquear peticiones concurrentes', async () => {
      let remainingBalance = 1;

      // Sobrescribimos la transacción para emular el decremento real atómico
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
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
      });

      const promises = Array.from({ length: 10 }).map(() =>
        pickupService.requestPickup({
          userId: 'user-night-1',
          barId: 'bar-pista-123',
          items: [{ orderItemId: 'order-item-fernet', quantityToRedeem: 1 }],
        })
      );

      const results = await Promise.allSettled(promises);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(9);
      expect(remainingBalance).toBe(0);
    });
  });

  describe('2. Test de Idempotencia en Red Inestable (X-Idempotency-Key)', () => {
    it('debe devolver respuesta cacheada sin duplicar ejecuciones ante reintentos de 4G', async () => {
      const interceptor = new IdempotencyInterceptor(mockRedis as any);
      const executionCount = { count: 0 };

      const mockCallHandler = {
        handle: () => {
          executionCount.count++;
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
            header: jest.fn(),
          }),
        }),
      });

      const key = 'uuid-retry-test-123';

      // 1ra petición
      const firstResult = await interceptor.intercept(createMockContext(key) as any, mockCallHandler);
      let data1: any;
      firstResult.subscribe((val) => (data1 = val));

      // 2da y 3ra peticiones con la misma clave
      const secondResult = await interceptor.intercept(createMockContext(key) as any, mockCallHandler);
      let data2: any;
      secondResult.subscribe((val) => (data2 = val));

      expect(executionCount.count).toBe(1); // Se ejecutó solo una vez
      expect(data1).toEqual(data2);
    });
  });

  describe('3. Test de Avalancha en Barra (Throttling FIFO con max_concurrent_prep = 15)', () => {
    it('debe enviar exactamente 15 tickets a IN_PREPARATION y encolar el resto en la cola FIFO de Redis', async () => {
      const barId = 'bar-pista-123';
      const maxConcurrent = 15;
      const totalUsers = 30;

      for (let i = 0; i < totalUsers; i++) {
        await pickupService.requestPickup({
          userId: `user-${i}`,
          barId,
          items: [{ orderItemId: 'order-item-fernet', quantityToRedeem: 1 }],
        });
      }

      const activeSet = mockRedis.sets.get(`bar:active:${barId}`);
      const queueList = mockRedis.lists.get(`bar:queue:${barId}`);

      expect(activeSet?.size).toBe(maxConcurrent);
      expect(queueList?.length).toBe(totalUsers - maxConcurrent); // Los restantes 15 en cola FIFO
    });
  });

  describe('4. Test de Validación Offline y Anti-Replay', () => {
    it('debe rechazar con ALERTA ROJA si un ticket ya fue marcado como DELIVERED', async () => {
      // Mock de ticket que ya figura como DELIVERED
      mockPrisma.pickupTicket.findUnique.mockResolvedValueOnce({
        id: 'ticket-delivered-already',
        status: TicketStatus.DELIVERED,
        deliveredAt: new Date(),
        items: [],
      });

      await expect(
        pickupService.validateAndDeliverTicket('ticket-delivered-already')
      ).rejects.toThrow('¡ALERTA DE SEGURIDAD! El ticket ya fue entregado previamente.');
    });
  });
});
