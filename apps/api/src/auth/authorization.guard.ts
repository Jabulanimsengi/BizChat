import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { BusinessRole } from '@prisma/client';
import type { AuthenticatedRequest } from '../common/http.types';
import { PERMISSIONS_KEY, ROLES_KEY } from './auth.decorators';
import { roleHasPermission, type Permission } from './rbac';

@Injectable()
export class AuthorizationGuard implements CanActivate {
  public constructor(private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const roles =
      this.reflector.getAllAndOverride<BusinessRole[]>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const required =
      this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const role = context.switchToHttp().getRequest<AuthenticatedRequest>().auth.membership.role;
    if (
      (roles.length > 0 && !roles.includes(role)) ||
      required.some((permission) => !roleHasPermission(role, permission))
    ) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission for this action',
      });
    }
    return true;
  }
}
