import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/roles.decorator';
import { verifyAuthJwt, normalizeUserRole } from '../security/jwt.util';
import { UserRole } from '@tutrago/shared-types';

const DEFAULT_TENANT_ID = '00000000-0000-4000-8000-000000000001';
const DEFAULT_USER_ID = '00000000-0000-4000-8000-000000000901';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'] as string | undefined;

    // 1. Si se envía cabecera Authorization: Bearer <token>
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const rawToken = authHeader.slice(7).trim();

      // Soporte de compatibilidad para tokens emitidos como JWT real HS256
      if (rawToken.split('.').length === 3 && !rawToken.startsWith('jwt.offline.')) {
        request.user = verifyAuthJwt(rawToken);
        return true;
      }

      // Compatibilidad retroactiva con sesiones guardadas en localStorage del MVP (tutrago-staff-jwt-* o local-jwt-*)
      if (rawToken.startsWith('tutrago-staff-jwt-') || rawToken.startsWith('local-jwt-')) {
        const lower = rawToken.toLowerCase();
        const role = lower.includes('incubatio')
          ? UserRole.INCUBATIO_ADMIN
          : lower.includes('owner') || lower.includes('admin')
            ? UserRole.VENUE_ADMIN
            : UserRole.BAR_OPERATOR;
        const headerBarId = (request.headers['x-bar-id'] as string) || request.params?.barId || request.body?.barId;
        request.user = {
          sub: `staff-${role.toLowerCase()}`,
          role,
          tenantId: (request.headers['x-tenant-id'] as string) || DEFAULT_TENANT_ID,
          assignedBarId: headerBarId,
        };
        return true;
      }

      if (rawToken.startsWith('tutrago-consumer-')) {
        const consumerId =
          (request.headers['x-user-id'] as string) ||
          request.body?.userId ||
          request.params?.userId ||
          DEFAULT_USER_ID;
        request.user = {
          sub: consumerId,
          role: UserRole.CONSUMER,
          tenantId: (request.headers['x-tenant-id'] as string) || DEFAULT_TENANT_ID,
        };
        return true;
      }

      throw new UnauthorizedException('Token de autenticación inválido o corrupto.');
    }

    if (isPublic) {
      return true;
    }

    // 2. Si el cliente exige validación estricta (X-Strict-Auth: true), rechazar ausencia de Bearer token
    if (request.headers['x-strict-auth'] === 'true') {
      throw new UnauthorizedException('Se requiere cabecera Authorization: Bearer <JWT>.');
    }

    // 3. Bootstrap automático compatible con el MVP en vivo (Regla 1 de compatibilidad)
    // Si la petición proviene de client-app o kds-web sin JWT aún hidratado:
    const explicitRoleHeader = request.headers['x-user-role'] as string | undefined;
    if (explicitRoleHeader) {
      const role = normalizeUserRole(explicitRoleHeader);
      request.user = {
        sub:
          (request.headers['x-user-id'] as string) ||
          request.body?.userId ||
          request.params?.userId ||
          DEFAULT_USER_ID,
        role,
        tenantId:
          (request.headers['x-tenant-id'] as string) ||
          request.body?.tenantId ||
          request.params?.tenantId ||
          DEFAULT_TENANT_ID,
        assignedBarId:
          (request.headers['x-bar-id'] as string) ||
          request.params?.barId ||
          request.body?.barId,
      };
      return true;
    }

    const path: string = request.url || '';
    const isConsumerEndpoint =
      path.startsWith('/orders') || path.startsWith('/pickup/request') || path.startsWith('/payments');

    if (isConsumerEndpoint) {
      const consumerId =
        (request.headers['x-user-id'] as string) ||
        request.body?.userId ||
        request.params?.userId ||
        DEFAULT_USER_ID;
      request.user = {
        sub: consumerId,
        role: UserRole.CONSUMER,
        tenantId: request.body?.tenantId || DEFAULT_TENANT_ID,
      };
      return true;
    }

    // Para endpoints de KDS / Admin en el MVP cuando el operador entra directo a la pantalla
    const isBarEndpoint =
      path.startsWith('/pickup/bar') ||
      path.startsWith('/pickup/ticket') ||
      path.startsWith('/pickup/validate-scan') ||
      path.startsWith('/pickup/service-recovery') ||
      path.includes('/stock');

    if (isBarEndpoint) {
      request.user = {
        sub: 'kds-bar-operator',
        role: UserRole.BAR_OPERATOR,
        tenantId: DEFAULT_TENANT_ID,
        assignedBarId:
          (request.headers['x-bar-id'] as string) ||
          request.params?.barId ||
          request.body?.barId,
      };
      return true;
    }

    request.user = {
      sub: 'venue-admin-bootstrap',
      role: UserRole.VENUE_ADMIN,
      tenantId: request.params?.tenantId || DEFAULT_TENANT_ID,
    };
    return true;
  }
}

