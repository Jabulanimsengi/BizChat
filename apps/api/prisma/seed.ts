import { PrismaClient } from '@prisma/client';
import { hash } from 'argon2';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

async function seed(): Promise<void> {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Development seed must not run in production');
  const email = 'owner@demo.bizchat.local';
  const passwordHash = await hash(process.env.SEED_OWNER_PASSWORD ?? 'development-only-password');
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, displayName: 'Demo Owner', passwordHash, emailVerifiedAt: new Date() },
  });
  const business = await prisma.business.upsert({
    where: { slug: 'demo-business' },
    update: {},
    create: {
      name: 'Demo Business',
      slug: 'demo-business',
      publicId: 'pub_demo_business',
      timezone: 'Africa/Johannesburg',
      status: 'TRIAL',
    },
  });
  const membership = await prisma.businessMembership.upsert({
    where: { businessId_userId: { businessId: business.id, userId: user.id } },
    update: { role: 'OWNER', status: 'ACTIVE' },
    create: { businessId: business.id, userId: user.id, role: 'OWNER' },
  });
  const profile = await prisma.agentProfile.upsert({
    where: { membershipId: membership.id },
    update: { status: 'ACTIVE' },
    create: { businessId: business.id, userId: user.id, membershipId: membership.id },
  });
  const department = await prisma.department.upsert({
    where: { businessId_name: { businessId: business.id, name: 'General Support' } },
    update: { status: 'ACTIVE', isDefault: true },
    create: {
      businessId: business.id,
      publicId: `dept_${randomBytes(18).toString('base64url')}`,
      name: 'General Support',
      description: 'General customer enquiries',
      isDefault: true,
    },
  });
  await prisma.agentDepartment.upsert({
    where: {
      agentProfileId_departmentId: { agentProfileId: profile.id, departmentId: department.id },
    },
    update: {},
    create: { businessId: business.id, agentProfileId: profile.id, departmentId: department.id },
  });
  await prisma.widgetSettings.upsert({
    where: { businessId: business.id },
    update: {},
    create: { businessId: business.id },
  });
}

seed().finally(async () => prisma.$disconnect());
