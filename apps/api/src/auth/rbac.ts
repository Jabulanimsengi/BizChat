import type { BusinessRole } from '@prisma/client';

export const permissions = [
  'conversation:view_assigned',
  'conversation:view_all',
  'conversation:transfer',
  'conversation:resolve',
  'conversation:note',
  'conversation:tag',
  'conversation:export',
  'user:create',
  'user:disable',
  'department:manage',
  'analytics:view',
  'audit:view',
  'business:manage',
  'settings:manage',
] as const;
export type Permission = (typeof permissions)[number];

const rolePermissions: Record<BusinessRole, ReadonlySet<Permission>> = {
  OWNER: new Set(permissions),
  ADMIN: new Set(permissions.filter((permission) => permission !== 'business:manage')),
  SUPERVISOR: new Set([
    'conversation:view_assigned',
    'conversation:view_all',
    'conversation:transfer',
    'conversation:resolve',
    'conversation:note',
    'conversation:tag',
    'conversation:export',
    'analytics:view',
  ]),
  CONSULTANT: new Set([
    'conversation:view_assigned',
    'conversation:transfer',
    'conversation:resolve',
    'conversation:note',
    'conversation:tag',
  ]),
};

export function roleHasPermission(role: BusinessRole, permission: Permission): boolean {
  return rolePermissions[role].has(permission);
}
