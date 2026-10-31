import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, IS_PUBLIC_KEY } from '../decorators/roles.decorator';
import { UserRole, JwtAuthPayload } from '@tutrago/shared-types';
import { normalizeUserRole } from '../security/jwt.util';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<Array<UserRole | string>>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();
    const user: JwtAuthPayload | undefined = request.user;

    if (!user) {
      throw new ForbiddenException('Contexto de usuario no autenticado.');
    }

    const normalizedUserRole = normalizeUserRole(user.role);

    // INCUBATIO_ADMIN tiene permiso global sobre toda la plataforma
    if (normalizedUserRole === UserRole.INCUBATIO_ADMIN) {
      return true;
    }

    if (requiredRoles && requiredRoles.length > 0) {
      const normalizedRequiredRoles = requiredRoles.map((r) => normalizeUserRole(r));
      if (!normalizedRequiredRoles.includes(normalizedUserRole)) {
        throw new ForbiddenException(
          `Acceso denegado: El rol ${user.role} no tiene permisos para ejecutar esta operación (requiere: ${requiredRoles.join(', ')}).`
        );
      }
    }

    // Regla estricta CONSUMER: Solo puede consultar o operar recursos de su propio userId
    if (normalizedUserRole === UserRole.CONSUMER) {
      const targetUserId = request.params?.userId || request.body?.userId;
      if (targetUserId && user.sub && targetUserId !== user.sub) {
        throw new ForbiddenException(
          'Alerta de Seguridad (IDOR bloqueado): Un CONSUMER solo puede ver o canjear sus propias órdenes.'
        );
      }
    }

    // Regla estricta BAR_OPERATOR / BARTENDER: Solo puede operar sobre su barra asignada (assignedBarId / barId)
    if (normalizedUserRole === UserRole.BAR_OPERATOR) {
      const targetBarId = request.params?.barId || request.body?.barId;
      const operatorBarId = user.assignedBarId || user.barId;
      if (
        targetBarId &&
        operatorBarId &&
        targetBarId !== operatorBarId
      ) {
        throw new ForbiddenException(
          `Acceso denegado: El operador está asignado a la barra ${operatorBarId} y no puede operar la barra ${targetBarId}.`
        );
      }
    }

    return true;
  }
}

