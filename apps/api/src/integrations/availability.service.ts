import { Injectable } from '@nestjs/common';
import type { IntegrationAvailabilityResponse } from '@bizchat/types';
import { BusinessHoursService } from '../business-hours/business-hours.service';
import { PrismaService } from '../database/prisma.service';
import { PresenceService } from '../realtime/presence.service';
import { CAPACITY_STATUSES } from '../routing/routing-policy';

/** Whether a new chat would reach a consultant now, overall and per department. */
@Injectable()
export class AvailabilityService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly hours: BusinessHoursService,
  ) {}

  public async forBusiness(businessId: string): Promise<IntegrationAvailabilityResponse> {
    const [open, profiles, departments, load] = await Promise.all([
      this.hours.isOpenNow(businessId),
      this.prisma.agentProfile.findMany({
        where: {
          businessId,
          status: 'ACTIVE',
          routingEnabled: true,
          membership: { status: 'ACTIVE' },
          user: { status: 'ACTIVE' },
        },
        select: {
          id: true,
          membershipId: true,
          maxConcurrentChats: true,
          departments: { select: { departmentId: true } },
        },
      }),
      this.prisma.department.findMany({
        where: { businessId, status: 'ACTIVE' },
        select: { id: true, publicId: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.conversation.groupBy({
        by: ['assignedAgentMembershipId'],
        where: { businessId, status: { in: [...CAPACITY_STATUSES] } },
        _count: { _all: true },
      }),
    ]);
    const active = new Map(load.map((row) => [row.assignedAgentMembershipId, row._count._all]));
    const states = await Promise.all(
      profiles.map(async (profile) => {
        const online = (await this.presence.getAgentState(businessId, profile.id)) === 'ONLINE';
        return {
          departmentIds: profile.departments.map(({ departmentId }) => departmentId),
          online,
          available: online && (active.get(profile.membershipId) ?? 0) < profile.maxConcurrentChats,
        };
      }),
    );
    const count = (filter: (state: (typeof states)[number]) => boolean): number =>
      states.filter(filter).length;
    const onlineAgents = count((state) => state.online);
    return {
      open,
      availability: open && onlineAgents > 0 ? 'ONLINE' : 'OFFLINE',
      onlineAgents,
      availableAgents: count((state) => state.available),
      departments: departments.map((department) => ({
        publicId: department.publicId,
        name: department.name,
        onlineAgents: count((state) => state.online && state.departmentIds.includes(department.id)),
        availableAgents: count(
          (state) => state.available && state.departmentIds.includes(department.id),
        ),
      })),
      checkedAt: new Date().toISOString(),
    };
  }
}
