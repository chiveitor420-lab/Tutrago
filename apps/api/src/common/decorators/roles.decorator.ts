import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole, JwtAuthPayload } from '@tutrago/shared-types';

export const ROLES_KEY = 'tutrago_roles';
export const IS_PUBLIC_KEY = 'tutrago_is_public';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtAuthPayload | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  }
);

