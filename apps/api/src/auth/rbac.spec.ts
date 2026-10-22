import type { BusinessRole } from '@prisma/client';
import { roleHasPermission } from './rbac';

describe('role permissions', () => {
  it.each<[BusinessRole, boolean]>([
    ['OWNER', true],
    ['ADMIN', true],
    ['SUPERVISOR', false],
    ['CONSULTANT', false],
  ])('enforces settings access for %s', (role, allowed) => {
    expect(roleHasPermission(role, 'settings:manage')).toBe(allowed);
  });

  it('does not grant consultants tenant-wide conversation access', () => {
    expect(roleHasPermission('CONSULTANT', 'conversation:view_all')).toBe(false);
  });
});
