import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async getTenantBySlug(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      include: {
        bars: { where: { status: 'ACTIVE' } },
      },
    });
    if (!tenant) throw new NotFoundException(`Boliche con slug "${slug}" no encontrado.`);
    return tenant;
  }

  async getBarsByTenant(tenantId: string) {
    return this.prisma.bar.findMany({
      where: { tenantId, status: 'ACTIVE' },
    });
  }

  async getBarById(barId: string) {
    const bar = await this.prisma.bar.findUnique({
      where: { id: barId },
      include: { tenant: true },
    });
    if (!bar) throw new NotFoundException(`Barra ${barId} no encontrada.`);
    return bar;
  }
}
