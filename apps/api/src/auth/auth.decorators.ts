import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { BusinessRole } from '@prisma/client';
import type { AuthContext, AuthenticatedRequest } from '../common/http.types';
import type { Permission } from './rbac';

export const ROLES_KEY = 'bizchat:roles';
export const PERMISSIONS_KEY = 'bizchat:permissions';

export const RequireRoles = (...roles: BusinessRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
export const RequirePermissions = (
  ...permissions: Permission[]
): MethodDecorator & ClassDecorator => SetMetadata(PERMISSIONS_KEY, permissions);

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().auth,
);
