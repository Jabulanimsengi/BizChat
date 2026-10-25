import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { AgentProfile, User } from '@prisma/client';
import type { AgentPresenceEvent, AgentPresenceState, AgentProfileResponse } from '@bizchat/types';
import type { AgentProfileUpdateInput } from '@bizchat/validation';
import type { AuthContext } from '../common/http.types';
import { PrismaService } from '../database/prisma.service';
import { PresenceService } from '../realtime/presence.service';
import { CAPACITY_STATUSES } from '../routing/routing-policy';
import {
  CONVERSATION_CAPACITY_RELEASED_EVENT,
  type ConversationCapacityReleasedApplicationEvent,
} from '../routing/routing-events';
import { BusinessHoursService } from '../business-hours/business-hours.service';

type ProfileWithUser = AgentProfile & { user: User; departments: { departmentId: string }[] };

@Injectable()
export class AgentProfileService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly events: EventEmitter2,
    private readonly businessHours: BusinessHoursService,
  ) {}

  /** Presence for a profile the server changed itself, e.g. after missed offers. */
  public async presenceEventFor(profileId: string): Promise<AgentPresenceEvent> {
    const profile = await this.prisma.agentProfile.findUniqueOrThrow({
      where: { id: profileId },
      include: { user: true, departments: { select: { departmentId: true } } },
    });
    return this.presenceEvent(profile);
  }

  public async getOrCreate(auth: AuthContext): Promise<ProfileWithUser> {
    return this.prisma.agentProfile.upsert({
      where: { membershipId: auth.membership.id },
      update: {},
      create: {
        businessId: auth.business.id,
        userId: auth.user.id,
        membershipId: auth.membership.id,
      },
      include: { user: true, departments: { select: { departmentId: true } } },
    });
  }

  public async getMine(auth: AuthContext): Promise<AgentProfileResponse> {
    return this.response(auth.business.id, await this.getOrCreate(auth));
  }

  public async updateMine(
    auth: AuthContext,
    input: AgentProfileUpdateInput,
  ): Promise<AgentProfileResponse> {
    await this.getOrCreate(auth);
    const profile = await this.prisma.agentProfile.update({
      where: { membershipId: auth.membership.id },
      data: input,
      include: { user: true, departments: { select: { departmentId: true } } },
    });
    if (
      input.routingEnabled === true ||
      input.status === 'ACTIVE' ||
      input.maxConcurrentChats !== undefined
    ) {
      this.events.emit(CONVERSATION_CAPACITY_RELEASED_EVENT, {
        businessId: auth.business.id,
        agentMembershipId: auth.membership.id,
        conversationId: 'agent-profile-change',
      } satisfies ConversationCapacityReleasedApplicationEvent);
    }
    return this.response(auth.business.id, profile);
  }

  public async listBusiness(businessId: string): Promise<AgentProfileResponse[]> {
    const profiles = await this.prisma.agentProfile.findMany({
      where: { businessId, status: 'ACTIVE' },
      include: { user: true, departments: { select: { departmentId: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(profiles.map((profile) => this.response(businessId, profile)));
  }

  public async businessAvailability(
    businessId: string,
  ): Promise<{ availability: 'ONLINE' | 'OFFLINE'; onlineAgents: number }> {
    const profiles = await this.listBusiness(businessId);
    const onlineAgents = profiles.filter((profile) => profile.presence === 'ONLINE').length;
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { timezone: true },
    });
    const isOpen = await this.businessHours.isBusinessOpen(businessId, business.timezone);
    return { availability: onlineAgents > 0 && isOpen ? 'ONLINE' : 'OFFLINE', onlineAgents };
  }

  public async presenceEvent(
    profile: ProfileWithUser,
    state?: AgentPresenceState,
  ): Promise<AgentPresenceEvent> {
    const activeChats = await this.activeChats(profile.businessId, profile.membershipId);
    const resolvedState =
      state ?? (await this.presence.getAgentState(profile.businessId, profile.id));
    return {
      agentProfileId: profile.id,
      membershipId: profile.membershipId,
      displayName: profile.user.displayName,
      state:
        resolvedState === 'ONLINE' && activeChats >= profile.maxConcurrentChats
          ? ('BUSY' as const)
          : resolvedState,
      activeChats,
      maxConcurrentChats: profile.maxConcurrentChats,
      changedAt: new Date().toISOString(),
    };
  }

  private async response(
    businessId: string,
    profile: ProfileWithUser,
  ): Promise<AgentProfileResponse> {
    const event = await this.presenceEvent(profile);
    return {
      id: profile.id,
      membershipId: profile.membershipId,
      user: {
        id: profile.user.id,
        displayName: profile.user.displayName,
        email: profile.user.email,
      },
      maxConcurrentChats: profile.maxConcurrentChats,
      routingEnabled: profile.routingEnabled,
      status: profile.status,
      presence: event.state,
      activeChats: event.activeChats,
      departmentIds: profile.departments.map(({ departmentId }) => departmentId),
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  private activeChats(businessId: string, membershipId: string): Promise<number> {
    return this.prisma.conversation.count({
      where: {
        businessId,
        assignedAgentMembershipId: membershipId,
        status: { in: [...CAPACITY_STATUSES] },
      },
    });
  }
}
