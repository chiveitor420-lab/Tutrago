import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@tutrago/database';
import * as crypto from 'node:crypto';

/**
 * PrismaService con Contingencia Relacional en Memoria (In-Memory Store).
 * Si PostgreSQL está activo, opera nativamente con PrismaClient.
 * Si PostgreSQL no está levantado localmente, activa automáticamente el almacén
 * relacional en memoria con el seed completo del Club Nocturno Tutrago Central.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  public isUsingMemoryFallback = false;

  private mem = {
    tenants: new Map<string, any>(),
    bars: new Map<string, any>(),
    products: new Map<string, any>(),
    productUpsells: new Map<string, any>(),
    users: new Map<string, any>(),
    orders: new Map<string, any>(),
    orderItems: new Map<string, any>(),
    pickupTickets: new Map<string, any>(),
    pickupTicketItems: new Map<string, any>(),
  };

  async onModuleInit() {
    try {
      await Promise.race([
        this.$connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout conectando a PostgreSQL local')), 2000)
        ),
      ]);
      console.log('[PrismaService] Conectado exitosamente a PostgreSQL.');
    } catch (error: any) {
      console.warn(
        `[PrismaService] PostgreSQL local no disponible (${error?.message || 'offline'}). Activando motor relacional en memoria con Seed de Prueba Piloto.`
      );
      this.enableMemoryFallback();
    }
  }

  async onModuleDestroy() {
    if (!this.isUsingMemoryFallback) {
      await this.$disconnect();
    }
  }

  private enableMemoryFallback() {
    this.isUsingMemoryFallback = true;
    this.seedMemoryStore();

    const self = this;

    // Relación helper
    const enrichBar = (bar: any, include?: any) => {
      if (!bar) return null;
      const copy = { ...bar };
      if (include?.tenant) {
        copy.tenant = self.mem.tenants.get(bar.tenantId) || null;
      }
      if (include?.tickets) {
        copy.tickets = Array.from(self.mem.pickupTickets.values()).filter(
          (t) => t.barId === bar.id
        );
      }
      return copy;
    };

    const enrichProduct = (prod: any, include?: any) => {
      if (!prod) return null;
      const copy = { ...prod };
      if (include?.upsells) {
        copy.upsells = Array.from(self.mem.productUpsells.values()).filter(
          (u) => u.productId === prod.id
        );
      }
      if (include?.tenant) {
        copy.tenant = self.mem.tenants.get(prod.tenantId) || null;
      }
      return copy;
    };

    const enrichOrderItem = (oi: any, include?: any) => {
      if (!oi) return null;
      const copy = { ...oi };
      if (include?.product) {
        const p = self.mem.products.get(oi.productId);
        copy.product = enrichProduct(p, typeof include.product === 'object' ? include.product.include : undefined);
      }
      if (include?.order) {
        copy.order = self.mem.orders.get(oi.orderId) || null;
      }
      return copy;
    };

    const enrichTicket = (t: any, include?: any) => {
      if (!t) return null;
      const copy = { ...t };
      if (include?.bar) {
        copy.bar = self.mem.bars.get(t.barId) || null;
      }
      if (include?.order) {
        copy.order = self.mem.orders.get(t.orderId) || null;
      }
      if (include?.items) {
        const rawItems = Array.from(self.mem.pickupTicketItems.values()).filter(
          (pti) => pti.ticketId === t.id
        );
        copy.items = rawItems.map((pti) => {
          const itemCopy = { ...pti };
          if (typeof include.items === 'object' && include.items.include?.orderItem) {
            const oi = self.mem.orderItems.get(pti.orderItemId);
            itemCopy.orderItem = enrichOrderItem(
              oi,
              typeof include.items.include.orderItem === 'object'
                ? include.items.include.orderItem.include
                : undefined
            );
          }
          return itemCopy;
        });
      }
      return copy;
    };

    // Override delegates
    (this as any).tenant = {
      findUnique: async ({ where, include }: any) => {
        let found: any = null;
        if (where?.id) found = self.mem.tenants.get(where.id) || null;
        else if (where?.slug) {
          found = Array.from(self.mem.tenants.values()).find((t) => t.slug === where.slug) || null;
        }
        if (!found) return null;
        const copy = { ...found };
        if (include?.bars) {
          let bars = Array.from(self.mem.bars.values()).filter((b) => b.tenantId === found.id);
          if (typeof include.bars === 'object' && include.bars.where?.status) {
            bars = bars.filter((b) => b.status === include.bars.where.status);
          }
          copy.bars = bars;
        }
        return copy;
      },
      findFirst: async ({ where }: any = {}) => {
        const all = Array.from(self.mem.tenants.values());
        if (!where) return all[0] || null;
        return (
          all.find((t) => {
            if (where.id && t.id !== where.id) return false;
            if (where.slug && t.slug !== where.slug) return false;
            return true;
          }) || null
        );
      },
      findMany: async () => Array.from(self.mem.tenants.values()),
    };

    (this as any).bar = {
      findUnique: async ({ where, include }: any) => {
        const b = self.mem.bars.get(where?.id) || null;
        return enrichBar(b, include);
      },
      findMany: async ({ where, include, orderBy }: any = {}) => {
        let list = Array.from(self.mem.bars.values());
        if (where?.tenantId) list = list.filter((b) => b.tenantId === where.tenantId);
        if (where?.status) list = list.filter((b) => b.status === where.status);
        if (orderBy?.createdAt === 'asc') {
          list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        }
        return list.map((b) => enrichBar(b, include));
      },
      create: async ({ data, include }: any) => {
        const id = data.id || crypto.randomUUID();
        const now = new Date();
        const bar = {
          id,
          tenantId: data.tenantId,
          name: data.name,
          maxConcurrentPrep: Number(data.maxConcurrentPrep ?? 15),
          printerType: data.printerType || 'WEB_SERIAL_80MM',
          printerIp: data.printerIp || null,
          status: data.status || 'ACTIVE',
          createdAt: now,
          updatedAt: now,
        };
        self.mem.bars.set(id, bar);
        return enrichBar(bar, include);
      },
      update: async ({ where, data, include }: any) => {
        const existing = self.mem.bars.get(where.id);
        if (!existing) throw new Error(`Bar ${where.id} not found`);
        const updated = {
          ...existing,
          ...data,
          maxConcurrentPrep:
            data.maxConcurrentPrep !== undefined
              ? Number(data.maxConcurrentPrep)
              : existing.maxConcurrentPrep,
          updatedAt: new Date(),
        };
        self.mem.bars.set(where.id, updated);
        return enrichBar(updated, include);
      },
      delete: async ({ where }: any) => {
        const existing = self.mem.bars.get(where.id);
        self.mem.bars.delete(where.id);
        return existing;
      },
    };

    (this as any).product = {
      findUnique: async ({ where, include }: any) => {
        const p = self.mem.products.get(where?.id) || null;
        return enrichProduct(p, include);
      },
      findFirst: async ({ where, include }: any = {}) => {
        const list = Array.from(self.mem.products.values());
        const found = list.find((p) => {
          if (where?.id && p.id !== where.id) return false;
          if (where?.tenantId && p.tenantId !== where.tenantId) return false;
          if (where?.name?.contains) {
            return p.name.toLowerCase().includes(where.name.contains.toLowerCase());
          }
          return true;
        });
        return enrichProduct(found || null, include);
      },
      findMany: async ({ where, include, orderBy, take }: any = {}) => {
        let list = Array.from(self.mem.products.values());
        if (where?.tenantId) list = list.filter((p) => p.tenantId === where.tenantId);
        if (where?.category) list = list.filter((p) => p.category === where.category);
        if (where?.isAvailable !== undefined) {
          list = list.filter((p) => p.isAvailable === where.isAvailable);
        }
        if (where?.id?.not) {
          list = list.filter((p) => p.id !== where.id.not);
        }
        if (orderBy?.sortOrder) {
          list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        }
        if (take) list = list.slice(0, take);
        return list.map((p) => enrichProduct(p, include));
      },
      create: async ({ data, include }: any) => {
        const id = data.id || crypto.randomUUID();
        const now = new Date();
        const prod = {
          id,
          tenantId: data.tenantId,
          name: data.name,
          description: data.description || '',
          price: Number(data.price),
          category: data.category || 'Tragos Clásicos',
          imageUrl: data.imageUrl || null,
          isAvailable: data.isAvailable !== undefined ? Boolean(data.isAvailable) : true,
          sortOrder: data.sortOrder ?? self.mem.products.size + 1,
          createdAt: now,
          updatedAt: now,
        };
        self.mem.products.set(id, prod);

        if (data.upsells?.create && Array.isArray(data.upsells.create)) {
          for (const u of data.upsells.create) {
            const uId = u.id || crypto.randomUUID();
            self.mem.productUpsells.set(uId, {
              id: uId,
              productId: id,
              title: u.title,
              additionalPrice: Number(u.additionalPrice),
              description: u.description || '',
              createdAt: now,
            });
          }
        }
        return enrichProduct(prod, include);
      },
      update: async ({ where, data, include }: any) => {
        const existing = self.mem.products.get(where.id);
        if (!existing) throw new Error(`Product ${where.id} not found`);
        const { upsells, ...scalarData } = data;
        const updated = {
          ...existing,
          ...scalarData,
          price: scalarData.price !== undefined ? Number(scalarData.price) : existing.price,
          updatedAt: new Date(),
        };
        self.mem.products.set(where.id, updated);

        if (upsells) {
          if (upsells.deleteMany) {
            for (const [uId, uVal] of self.mem.productUpsells.entries()) {
              if (uVal.productId === where.id) {
                self.mem.productUpsells.delete(uId);
              }
            }
          }
          if (Array.isArray(upsells.create)) {
            for (const u of upsells.create) {
              const uId = u.id || crypto.randomUUID();
              self.mem.productUpsells.set(uId, {
                id: uId,
                productId: where.id,
                title: u.title,
                additionalPrice: Number(u.additionalPrice),
                description: u.description || '',
                createdAt: new Date(),
              });
            }
          }
        }
        return enrichProduct(updated, include);
      },
      delete: async ({ where }: any) => {
        const existing = self.mem.products.get(where.id);
        self.mem.products.delete(where.id);
        for (const [uId, uVal] of self.mem.productUpsells.entries()) {
          if (uVal.productId === where.id) self.mem.productUpsells.delete(uId);
        }
        return existing;
      },
    };

    (this as any).productUpsell = {
      findMany: async ({ where }: any = {}) => {
        let list = Array.from(self.mem.productUpsells.values());
        if (where?.productId) list = list.filter((u) => u.productId === where.productId);
        return list;
      },
      create: async ({ data }: any) => {
        const id = data.id || crypto.randomUUID();
        const upsell = {
          id,
          productId: data.productId,
          title: data.title,
          additionalPrice: Number(data.additionalPrice),
          description: data.description || '',
          createdAt: new Date(),
        };
        self.mem.productUpsells.set(id, upsell);
        return upsell;
      },
      deleteMany: async ({ where }: any = {}) => {
        let count = 0;
        for (const [uId, uVal] of self.mem.productUpsells.entries()) {
          if (!where?.productId || uVal.productId === where.productId) {
            self.mem.productUpsells.delete(uId);
            count++;
          }
        }
        return { count };
      },
      delete: async ({ where }: any) => {
        const u = self.mem.productUpsells.get(where.id);
        self.mem.productUpsells.delete(where.id);
        return u;
      },
    };

    (this as any).user = {
      findUnique: async ({ where }: any) => {
        if (where?.id) return self.mem.users.get(where.id) || null;
        if (where?.email) {
          return Array.from(self.mem.users.values()).find((u) => u.email === where.email) || null;
        }
        return null;
      },
      create: async ({ data }: any) => {
        const id = data.id || crypto.randomUUID();
        const user = {
          id,
          email: data.email,
          phone: data.phone || null,
          fullName: data.fullName,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        self.mem.users.set(id, user);
        return user;
      },
    };

    (this as any).order = {
      findUnique: async ({ where, include }: any) => {
        const o = self.mem.orders.get(where?.id) || null;
        if (!o) return null;
        const copy = { ...o };
        if (include?.tenant) copy.tenant = self.mem.tenants.get(o.tenantId) || null;
        if (include?.items) {
          const items = Array.from(self.mem.orderItems.values()).filter(
            (oi) => oi.orderId === o.id
          );
          copy.items = items.map((oi) =>
            enrichOrderItem(oi, typeof include.items === 'object' ? include.items.include : undefined)
          );
        }
        return copy;
      },
      findMany: async ({ where, include }: any = {}) => {
        let list = Array.from(self.mem.orders.values());
        if (where?.tenantId) list = list.filter((o) => o.tenantId === where.tenantId);
        if (where?.paymentStatus) list = list.filter((o) => o.paymentStatus === where.paymentStatus);
        return list.map((o) => {
          const copy = { ...o };
          if (include?.items) {
            copy.items = Array.from(self.mem.orderItems.values())
              .filter((oi) => oi.orderId === o.id)
              .map((oi) =>
                enrichOrderItem(oi, typeof include.items === 'object' ? include.items.include : undefined)
              );
          }
          return copy;
        });
      },
      create: async ({ data, include }: any) => {
        const id = data.id || crypto.randomUUID();
        const now = new Date();
        const order = {
          id,
          userId: data.userId,
          tenantId: data.tenantId,
          totalAmount: Number(data.totalAmount),
          platformFee: Number(data.platformFee),
          mpPreferenceId: data.mpPreferenceId || null,
          mpPaymentId: data.mpPaymentId || null,
          paymentStatus: data.paymentStatus || 'CREATED',
          createdAt: now,
          updatedAt: now,
        };
        self.mem.orders.set(id, order);

        if (data.items?.create && Array.isArray(data.items.create)) {
          for (const item of data.items.create) {
            const oiId = item.id || crypto.randomUUID();
            self.mem.orderItems.set(oiId, {
              id: oiId,
              orderId: id,
              productId: item.productId,
              unitPrice: Number(item.unitPrice),
              quantityPurchased: Number(item.quantityPurchased),
              quantityRemaining: Number(item.quantityRemaining ?? 0),
              selectedUpsellId: item.selectedUpsellId || null,
              createdAt: now,
              updatedAt: now,
            });
          }
        }
        return (self as any).order.findUnique({ where: { id }, include });
      },
      update: async ({ where, data, include }: any) => {
        const existing = self.mem.orders.get(where.id);
        if (!existing) throw new Error(`Order ${where.id} not found`);
        const updated = { ...existing, ...data, updatedAt: new Date() };
        self.mem.orders.set(where.id, updated);
        return (self as any).order.findUnique({ where: { id: where.id }, include });
      },
    };

    (this as any).orderItem = {
      findUnique: async ({ where, include }: any) => {
        const oi = self.mem.orderItems.get(where?.id) || null;
        return enrichOrderItem(oi, include);
      },
      findMany: async ({ where, include, orderBy }: any = {}) => {
        let list = Array.from(self.mem.orderItems.values());
        if (where?.order) {
          list = list.filter((oi) => {
            const ord = self.mem.orders.get(oi.orderId);
            if (!ord) return false;
            if (where.order.userId && ord.userId !== where.order.userId) return false;
            if (where.order.tenantId && ord.tenantId !== where.order.tenantId) return false;
            if (where.order.paymentStatus && ord.paymentStatus !== where.order.paymentStatus)
              return false;
            return true;
          });
        }
        if (where?.quantityRemaining?.gt !== undefined) {
          list = list.filter((oi) => oi.quantityRemaining > where.quantityRemaining.gt);
        }
        if (orderBy?.createdAt === 'desc') {
          list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        }
        return list.map((oi) => enrichOrderItem(oi, include));
      },
      update: async ({ where, data }: any) => {
        const existing = self.mem.orderItems.get(where.id);
        if (!existing) throw new Error(`OrderItem ${where.id} not found`);
        let nextRemaining = existing.quantityRemaining;
        if (typeof data.quantityRemaining === 'number') {
          nextRemaining = data.quantityRemaining;
        } else if (data.quantityRemaining?.decrement !== undefined) {
          nextRemaining = existing.quantityRemaining - data.quantityRemaining.decrement;
        } else if (data.quantityRemaining?.increment !== undefined) {
          nextRemaining = existing.quantityRemaining + data.quantityRemaining.increment;
        }
        const updated = {
          ...existing,
          ...data,
          quantityRemaining: nextRemaining,
          updatedAt: new Date(),
        };
        self.mem.orderItems.set(where.id, updated);
        return updated;
      },
    };

    (this as any).pickupTicket = {
      findUnique: async ({ where, include }: any) => {
        const t = self.mem.pickupTickets.get(where?.id) || null;
        return enrichTicket(t, include);
      },
      findFirst: async ({ where, include, orderBy }: any = {}) => {
        let list = Array.from(self.mem.pickupTickets.values());
        if (where?.shortCode) {
          list = list.filter(
            (t) => t.shortCode.toUpperCase() === String(where.shortCode).toUpperCase()
          );
        }
        if (where?.barId) {
          list = list.filter((t) => t.barId === where.barId);
        }
        if (orderBy?.activatedAt === 'desc') {
          list.sort((a, b) => new Date(b.activatedAt).getTime() - new Date(a.activatedAt).getTime());
        }
        return enrichTicket(list[0] || null, include);
      },
      findMany: async ({ where, include, orderBy }: any = {}) => {
        let list = Array.from(self.mem.pickupTickets.values());
        if (where?.barId) list = list.filter((t) => t.barId === where.barId);
        if (where?.status?.in) {
          list = list.filter((t) => where.status.in.includes(t.status));
        } else if (where?.status) {
          list = list.filter((t) => t.status === where.status);
        }
        if (orderBy?.activatedAt === 'asc') {
          list.sort((a, b) => new Date(a.activatedAt).getTime() - new Date(b.activatedAt).getTime());
        } else if (orderBy?.activatedAt === 'desc') {
          list.sort((a, b) => new Date(b.activatedAt).getTime() - new Date(a.activatedAt).getTime());
        }
        return list.map((t) => enrichTicket(t, include));
      },
      create: async ({ data, include }: any) => {
        const id = data.id || crypto.randomUUID();
        const now = new Date();
        const ticket = {
          id,
          orderId: data.orderId,
          barId: data.barId,
          status: data.status || 'PREP_REQUESTED',
          shortCode: data.shortCode,
          securityColor: data.securityColor,
          offlineQrJwt: data.offlineQrJwt || '',
          activatedAt: data.activatedAt || now,
          readyAt: data.readyAt || null,
          deliveredAt: data.deliveredAt || null,
        };
        self.mem.pickupTickets.set(id, ticket);

        if (data.items?.create && Array.isArray(data.items.create)) {
          for (const item of data.items.create) {
            const ptiId = item.id || crypto.randomUUID();
            self.mem.pickupTicketItems.set(ptiId, {
              id: ptiId,
              ticketId: id,
              orderItemId: item.orderItemId,
              quantity: Number(item.quantity),
            });
          }
        }
        return enrichTicket(ticket, include);
      },
      update: async ({ where, data, include }: any) => {
        const existing = self.mem.pickupTickets.get(where.id);
        if (!existing) throw new Error(`Ticket ${where.id} not found`);
        const updated = { ...existing, ...data };
        self.mem.pickupTickets.set(where.id, updated);
        return enrichTicket(updated, include);
      },
    };

    (this as any).pickupTicketItem = {
      findMany: async ({ where }: any = {}) => {
        let list = Array.from(self.mem.pickupTicketItems.values());
        if (where?.ticketId) list = list.filter((i) => i.ticketId === where.ticketId);
        return list;
      },
      update: async ({ where, data }: any) => {
        const existing = self.mem.pickupTicketItems.get(where.id);
        if (!existing) throw new Error(`PickupTicketItem ${where.id} not found`);
        const updated = { ...existing, ...data };
        self.mem.pickupTicketItems.set(where.id, updated);
        return updated;
      },
    };

    (this as any).$queryRaw = async (strings: TemplateStringsArray, ...values: any[]) => {
      const orderItemId = values[0];
      const oi = self.mem.orderItems.get(orderItemId);
      if (!oi) return [];
      return [
        {
          id: oi.id,
          order_id: oi.orderId,
          product_id: oi.productId,
          quantity_remaining: oi.quantityRemaining,
        },
      ];
    };

    (this as any).$transaction = async (fnOrArray: any) => {
      if (typeof fnOrArray === 'function') {
        return fnOrArray(self);
      }
      return Promise.all(fnOrArray);
    };
  }

  private seedMemoryStore() {
    const tenantId = '00000000-0000-4000-8000-000000000001';
    const now = new Date();

    this.mem.tenants.set(tenantId, {
      id: tenantId,
      name: 'Club Nocturno Tutrago Central',
      slug: 'club-tutrago',
      commissionPct: 10.0,
      isActive: true,
      mpAccessToken: 'TEST-ACCESS-TOKEN-TUTRAGO-BOLICHE',
      createdAt: now,
      updatedAt: now,
    });

    const barsData = [
      {
        id: '00000000-0000-4000-8000-000000000101',
        tenantId,
        name: 'Barra Pista Central',
        maxConcurrentPrep: 15,
        printerType: 'WEB_SERIAL_80MM',
        printerIp: '192.168.1.101',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: '00000000-0000-4000-8000-000000000102',
        tenantId,
        name: 'Barra Terraza VIP',
        maxConcurrentPrep: 10,
        printerType: 'WEB_USB_80MM',
        printerIp: '192.168.1.102',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: '00000000-0000-4000-8000-000000000103',
        tenantId,
        name: 'Barra Patio Electrónica',
        maxConcurrentPrep: 12,
        printerType: 'WEB_SERIAL_80MM',
        printerIp: '192.168.1.103',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    ];
    for (const b of barsData) this.mem.bars.set(b.id, b);

    const productsSeed = [
      {
        id: '00000000-0000-4000-8000-000000000501',
        name: 'Fernet Branca con Coca-Cola',
        description: 'El clásico argentino preparado con Fernet Branca de 750ml y hielo roca.',
        price: 9500,
        category: 'Tragos Clásicos',
        imageUrl: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=500',
        isAvailable: true,
        sortOrder: 1,
        upsells: [
          { title: 'Medida Doble de Fernet', additionalPrice: 4000, description: 'Agrega un 50% extra de Fernet Branca' },
          { title: 'Vaso Coleccionable XL', additionalPrice: 2500, description: 'Vaso térmico exclusivo de la noche' },
        ],
      },
      {
        id: '00000000-0000-4000-8000-000000000502',
        name: 'Gin Tonic Nacional',
        description: 'Gin artesanal nacional perfumado con bayas de enebro y tónica Schweppes.',
        price: 8500,
        category: 'Gin & Cocktails',
        imageUrl: 'https://images.unsplash.com/photo-1527661591475-527312dd65f5?w=500',
        isAvailable: true,
        sortOrder: 2,
        upsells: [
          { title: 'Upgrade a Gin Bombay Sapphire', additionalPrice: 4500, description: 'Cambia el gin nacional por Bombay Sapphire' },
          { title: 'Upgrade a Gin Hendrick’s', additionalPrice: 7000, description: 'Servido con rodajas de pepino y pimienta rosa' },
        ],
      },
      {
        id: '00000000-0000-4000-8000-000000000503',
        name: 'Vodka Smirnoff con Red Bull',
        description: 'Vodka triple destilación servido con lata fría de energizante.',
        price: 11000,
        category: 'Tragos con Energizante',
        imageUrl: 'https://images.unsplash.com/photo-1560512823-829485b8bf24?w=500',
        isAvailable: true,
        sortOrder: 3,
        upsells: [
          { title: 'Upgrade a Vodka Absolut', additionalPrice: 4000, description: 'Sabor más puro y sedoso' },
          { title: 'Upgrade a Grey Goose Premium', additionalPrice: 9000, description: 'Vodka premium francés de máxima pureza' },
        ],
      },
      {
        id: '00000000-0000-4000-8000-000000000504',
        name: 'Campari Orange',
        description: 'Campari italiano con jugo de naranja exprimido y rodaja fresca.',
        price: 8000,
        category: 'Tragos Clásicos',
        imageUrl: 'https://images.unsplash.com/photo-1536935338788-846bb9981813?w=500',
        isAvailable: false, // Marcado agotado para demostrar Service Recovery en 1 clic
        sortOrder: 4,
        upsells: [
          { title: 'Jugo de Naranja 100% Orgánico', additionalPrice: 1500, description: 'Naranjas recién exprimidas en frío' },
        ],
      },
      {
        id: '00000000-0000-4000-8000-000000000505',
        name: 'Mojito Clásico Cubano',
        description: 'Ron blanco, hojas de menta fresca machacada, lima, azúcar y soda.',
        price: 9000,
        category: 'Cocktails',
        imageUrl: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=500',
        isAvailable: true,
        sortOrder: 5,
        upsells: [
          { title: 'Upgrade a Ron Havana 7 Años', additionalPrice: 3500, description: 'Añejamiento natural en barricas de roble' },
        ],
      },
      {
        id: '00000000-0000-4000-8000-000000000506',
        name: 'Cerveza Corona 330ml',
        description: 'Porrón frío servido con gajo de lima.',
        price: 5500,
        category: 'Cervezas',
        imageUrl: 'https://images.unsplash.com/photo-1608270199042-4f911cf4e58b?w=500',
        isAvailable: true,
        sortOrder: 6,
        upsells: [
          { title: 'Balde de 5 Coronas', additionalPrice: 20000, description: 'Ahorro de $7.500 en balde de hielo' },
        ],
      },
      {
        id: '00000000-0000-4000-8000-000000000507',
        name: 'Cerveza Patagonia Bohemian Pilsener 730ml',
        description: 'Botella de cerveza artesanal rubia con maltas checas.',
        price: 8500,
        category: 'Cervezas',
        imageUrl: 'https://images.unsplash.com/photo-1535958636474-b021ee887b13?w=500',
        isAvailable: true,
        sortOrder: 7,
        upsells: [],
      },
      {
        id: '00000000-0000-4000-8000-000000000508',
        name: 'Whisky Johnnie Walker Red con Hielo',
        description: 'Whisky escocés blend clásico servido en vaso bajo con hielo tallado.',
        price: 10500,
        category: 'Whiskies',
        imageUrl: 'https://images.unsplash.com/photo-1527281400683-1aae777175f8?w=500',
        isAvailable: true,
        sortOrder: 8,
        upsells: [
          { title: 'Upgrade a Johnnie Walker Black Label (12 años)', additionalPrice: 6000, description: 'Perfil ahumado y notas a frutas oscuras' },
        ],
      },
      {
        id: '00000000-0000-4000-8000-000000000509',
        name: 'Aperol Spritz',
        description: 'Aperol, vino espumante Prosecco, golpe de soda y rodaja de naranja.',
        price: 9000,
        category: 'Cocktails',
        imageUrl: 'https://images.unsplash.com/photo-1560512823-829485b8bf24?w=500',
        isAvailable: true,
        sortOrder: 9,
        upsells: [
          { title: 'Espumante Chandon Extra Brut', additionalPrice: 3000, description: 'Base premium Chandon' },
        ],
      },
      {
        id: '00000000-0000-4000-8000-000000000510',
        name: 'Combo VIP: Botella Chandon + 4 Speed',
        description: 'Botella de 750ml en frapera con hielo y 4 latas de Speed Unlimited.',
        price: 36000,
        category: 'Combos VIP',
        imageUrl: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=500',
        isAvailable: true,
        sortOrder: 10,
        upsells: [
          { title: 'Upgrade a Chandon Délice', additionalPrice: 5000, description: 'Servido con hielo, albahaca y pomelo' },
          { title: 'Upgrade a Moët & Chandon Imperial', additionalPrice: 55000, description: 'Champagne francés de lujo' },
        ],
      },
      {
        id: '00000000-0000-4000-8000-000000000511',
        name: 'Combo VIP: Botella Jagermeister + 4 Red Bull',
        description: 'Botella de 700ml con 4 latas energizantes y 4 chupitos fríos.',
        price: 48000,
        category: 'Combos VIP',
        imageUrl: 'https://images.unsplash.com/photo-1549740425-8e95a9e6302f?w=500',
        isAvailable: true,
        sortOrder: 11,
        upsells: [],
      },
      {
        id: '00000000-0000-4000-8000-000000000512',
        name: 'Red Bull Energy Drink 250ml',
        description: 'Lata de bebida energizante fría.',
        price: 4500,
        category: 'Sin Alcohol',
        imageUrl: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=500',
        isAvailable: true,
        sortOrder: 12,
        upsells: [],
      },
      {
        id: '00000000-0000-4000-8000-000000000513',
        name: 'Agua Mineral Eco de los Andes 500ml',
        description: 'Agua pura de manantial sin gas bien fría.',
        price: 3000,
        category: 'Sin Alcohol',
        imageUrl: 'https://images.unsplash.com/photo-1548839140-29a749e1bc4e?w=500',
        isAvailable: true,
        sortOrder: 13,
        upsells: [],
      },
      {
        id: '00000000-0000-4000-8000-000000000514',
        name: 'Gaseosa Coca-Cola Original 354ml',
        description: 'Lata helada de Coca-Cola sabor original.',
        price: 3500,
        category: 'Sin Alcohol',
        imageUrl: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=500',
        isAvailable: true,
        sortOrder: 14,
        upsells: [],
      },
      {
        id: '00000000-0000-4000-8000-000000000515',
        name: 'Shot Tequila José Cuervo Especial',
        description: 'Chupito de tequila dorado servido con sal marina y rodaja de lima.',
        price: 5000,
        category: 'Shots',
        imageUrl: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=500',
        isAvailable: true,
        sortOrder: 15,
        upsells: [
          { title: 'Upgrade a Tequila Patrón Silver', additionalPrice: 4000, description: '100% agave azul ultra-premium' },
        ],
      },
    ];

    for (const p of productsSeed) {
      const { upsells, ...prodFields } = p;
      this.mem.products.set(p.id, {
        ...prodFields,
        tenantId,
        createdAt: now,
        updatedAt: now,
      });
      for (const u of upsells) {
        const uId = crypto.randomUUID();
        this.mem.productUpsells.set(uId, {
          id: uId,
          productId: p.id,
          title: u.title,
          additionalPrice: u.additionalPrice,
          description: u.description,
          createdAt: now,
        });
      }
    }

    // Usuario y Órdenes de la noche para nutrir tanto el KDS como las métricas en vivo de /admin
    const userId = '00000000-0000-4000-8000-000000000901';
    this.mem.users.set(userId, {
      id: userId,
      email: 'juan.perez@tutrago.com',
      fullName: 'Juan Pérez',
      phone: '+5491134567890',
      createdAt: now,
      updatedAt: now,
    });

    const ordersSeed = [
      {
        id: '00000000-0000-4000-8000-000000000201',
        userId,
        tenantId,
        totalAmount: 148500,
        platformFee: 14850,
        paymentStatus: 'PAID_ON_HOLD',
        mpPaymentId: 'MP-TEST-99281742',
        createdAt: new Date(Date.now() - 45 * 60000),
        updatedAt: now,
      },
      {
        id: '00000000-0000-4000-8000-000000000202',
        userId,
        tenantId,
        totalAmount: 96000,
        platformFee: 9600,
        paymentStatus: 'PAID_ON_HOLD',
        mpPaymentId: 'MP-TEST-99281890',
        createdAt: new Date(Date.now() - 25 * 60000),
        updatedAt: now,
      },
      {
        id: '00000000-0000-4000-8000-000000000203',
        userId,
        tenantId,
        totalAmount: 72000,
        platformFee: 7200,
        paymentStatus: 'PAID_ON_HOLD',
        mpPaymentId: 'MP-TEST-99281955',
        createdAt: new Date(Date.now() - 12 * 60000),
        updatedAt: now,
      },
    ];
    for (const o of ordersSeed) this.mem.orders.set(o.id, o);

    const orderItemsSeed = [
      {
        id: '00000000-0000-4000-8000-000000000301',
        orderId: '00000000-0000-4000-8000-000000000201',
        productId: '00000000-0000-4000-8000-000000000501', // Fernet
        unitPrice: 9500,
        quantityPurchased: 6,
        quantityRemaining: 4,
        selectedUpsellId: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: '00000000-0000-4000-8000-000000000302',
        orderId: '00000000-0000-4000-8000-000000000201',
        productId: '00000000-0000-4000-8000-000000000502', // Gin Tonic
        unitPrice: 8500,
        quantityPurchased: 4,
        quantityRemaining: 3,
        selectedUpsellId: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: '00000000-0000-4000-8000-000000000303',
        orderId: '00000000-0000-4000-8000-000000000202',
        productId: '00000000-0000-4000-8000-000000000503', // Vodka con Red Bull
        unitPrice: 11000,
        quantityPurchased: 4,
        quantityRemaining: 2,
        selectedUpsellId: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: '00000000-0000-4000-8000-000000000304',
        orderId: '00000000-0000-4000-8000-000000000202',
        productId: '00000000-0000-4000-8000-000000000504', // Campari Orange (Agotado -> Ideal para probar Service Recovery)
        unitPrice: 8000,
        quantityPurchased: 2,
        quantityRemaining: 1,
        selectedUpsellId: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: '00000000-0000-4000-8000-000000000305',
        orderId: '00000000-0000-4000-8000-000000000203',
        productId: '00000000-0000-4000-8000-000000000506', // Corona
        unitPrice: 5500,
        quantityPurchased: 6,
        quantityRemaining: 2,
        selectedUpsellId: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: '00000000-0000-4000-8000-000000000306',
        orderId: '00000000-0000-4000-8000-000000000203',
        productId: '00000000-0000-4000-8000-000000000510', // Combo VIP Chandon
        unitPrice: 36000,
        quantityPurchased: 2,
        quantityRemaining: 1,
        selectedUpsellId: null,
        createdAt: now,
        updatedAt: now,
      },
    ];
    for (const oi of orderItemsSeed) this.mem.orderItems.set(oi.id, oi);

    // Tickets activos y entregados iniciales en las barras
    const ticketsSeed = [
      {
        id: '00000000-0000-4000-8000-000000000701',
        orderId: '00000000-0000-4000-8000-000000000201',
        barId: '00000000-0000-4000-8000-000000000101',
        status: 'IN_PREPARATION',
        shortCode: 'A47',
        securityColor: '#10B981',
        offlineQrJwt: 'seed.jwt.A47',
        activatedAt: new Date(Date.now() - 2 * 60000),
        readyAt: null,
        deliveredAt: null,
        items: [
          { orderItemId: '00000000-0000-4000-8000-000000000301', quantity: 2 },
          { orderItemId: '00000000-0000-4000-8000-000000000302', quantity: 1 },
        ],
      },
      {
        id: '00000000-0000-4000-8000-000000000702',
        orderId: '00000000-0000-4000-8000-000000000202',
        barId: '00000000-0000-4000-8000-000000000101',
        status: 'IN_PREPARATION',
        shortCode: 'B12',
        securityColor: '#3B82F6',
        offlineQrJwt: 'seed.jwt.B12',
        activatedAt: new Date(Date.now() - 1 * 60000),
        readyAt: null,
        deliveredAt: null,
        items: [
          { orderItemId: '00000000-0000-4000-8000-000000000303', quantity: 1 },
          { orderItemId: '00000000-0000-4000-8000-000000000304', quantity: 1 }, // Campari Orange (agotado, muestra alerta Service Recovery en KDS)
        ],
      },
      {
        id: '00000000-0000-4000-8000-000000000703',
        orderId: '00000000-0000-4000-8000-000000000203',
        barId: '00000000-0000-4000-8000-000000000101',
        status: 'READY_FOR_PICKUP',
        shortCode: 'C89',
        securityColor: '#F59E0B',
        offlineQrJwt: 'seed.jwt.C89',
        activatedAt: new Date(Date.now() - 4 * 60000),
        readyAt: new Date(Date.now() - 1 * 60000),
        deliveredAt: null,
        items: [{ orderItemId: '00000000-0000-4000-8000-000000000305', quantity: 2 }],
      },
      {
        id: '00000000-0000-4000-8000-000000000704',
        orderId: '00000000-0000-4000-8000-000000000201',
        barId: '00000000-0000-4000-8000-000000000101',
        status: 'DELIVERED',
        shortCode: 'D24',
        securityColor: '#8B5CF6',
        offlineQrJwt: 'seed.jwt.D24',
        activatedAt: new Date(Date.now() - 15 * 60000),
        readyAt: new Date(Date.now() - 14 * 60000),
        deliveredAt: new Date(Date.now() - 13.5 * 60000),
        items: [{ orderItemId: '00000000-0000-4000-8000-000000000301', quantity: 2 }],
      },
      {
        id: '00000000-0000-4000-8000-000000000705',
        orderId: '00000000-0000-4000-8000-000000000203',
        barId: '00000000-0000-4000-8000-000000000102', // Barra Terraza VIP
        status: 'DELIVERED',
        shortCode: 'V08',
        securityColor: '#EC4899',
        offlineQrJwt: 'seed.jwt.V08',
        activatedAt: new Date(Date.now() - 10 * 60000),
        readyAt: new Date(Date.now() - 9 * 60000),
        deliveredAt: new Date(Date.now() - 8.8 * 60000),
        items: [{ orderItemId: '00000000-0000-4000-8000-000000000306', quantity: 1 }],
      },
    ];

    for (const t of ticketsSeed) {
      const { items, ...ticketFields } = t;
      this.mem.pickupTickets.set(t.id, ticketFields);
      for (const item of items) {
        const ptiId = crypto.randomUUID();
        this.mem.pickupTicketItems.set(ptiId, {
          id: ptiId,
          ticketId: t.id,
          orderItemId: item.orderItemId,
          quantity: item.quantity,
        });
      }
    }
  }
}
