import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@tutrago/database';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    try {
      await this.$connect();
      console.log('[PrismaService] Conectado exitosamente a PostgreSQL.');
    } catch (error) {
      console.warn('[PrismaService] Advertencia de conexión a base de datos:', error.message);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
