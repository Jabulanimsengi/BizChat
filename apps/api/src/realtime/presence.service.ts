import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AgentPresenceState } from '@bizchat/types';
import type { Environment } from '../config/environment';
import { RedisService } from './redis.service';

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
  private readonly ttlSeconds: number;

  public constructor(
    private readonly redis: RedisService,
    config: ConfigService<Environment, true>,
  ) {
    this.ttlSeconds = config.get('AGENT_PRESENCE_TTL_SECONDS', { infer: true });
  }

  public async connectAgent(
    businessId: string,
    profileId: string,
    socketId: string,
  ): Promise<AgentPresenceState> {
    return this.refreshAgent(businessId, profileId, socketId, 'ONLINE');
  }

  public async refreshAgent(
    businessId: string,
    profileId: string,
    socketId: string,
    defaultState?: Exclude<AgentPresenceState, 'OFFLINE'>,
  ): Promise<AgentPresenceState> {
    try {
      const now = Date.now();
      const expiresAt = now + this.ttlSeconds * 1000;
      const socketsKey = this.agentSocketsKey(businessId, profileId);
      const stateKey = this.agentStateKey(businessId, profileId);
      await this.redis
        .multi()
        .zremrangebyscore(socketsKey, 0, now)
        .zadd(socketsKey, expiresAt, socketId)
        .expire(socketsKey, this.ttlSeconds * 2)
        .set(stateKey, defaultState ?? 'ONLINE', 'EX', this.ttlSeconds * 2, 'NX')
        .exec();
      await this.redis.expire(stateKey, this.ttlSeconds * 2);
      return this.getAgentState(businessId, profileId);
    } catch (error) {
      this.logFailure(error);
      return 'OFFLINE';
    }
  }

  public async setAgentState(
    businessId: string,
    profileId: string,
    state: Exclude<AgentPresenceState, 'OFFLINE'>,
  ): Promise<AgentPresenceState> {
    try {
      await this.redis.set(
        this.agentStateKey(businessId, profileId),
        state,
        'EX',
        this.ttlSeconds * 2,
      );
      return state;
    } catch (error) {
      this.logFailure(error);
      return 'OFFLINE';
    }
  }

  public async disconnectAgent(
    businessId: string,
    profileId: string,
    socketId: string,
  ): Promise<AgentPresenceState> {
    try {
      await this.redis.zrem(this.agentSocketsKey(businessId, profileId), socketId);
      return this.getAgentState(businessId, profileId);
    } catch (error) {
      this.logFailure(error);
      return 'OFFLINE';
    }
  }

  public async getAgentState(businessId: string, profileId: string): Promise<AgentPresenceState> {
    try {
      const socketsKey = this.agentSocketsKey(businessId, profileId);
      await this.redis.zremrangebyscore(socketsKey, 0, Date.now());
      if ((await this.redis.zcard(socketsKey)) === 0) return 'OFFLINE';
      return (
        ((await this.redis.get(
          this.agentStateKey(businessId, profileId),
        )) as AgentPresenceState | null) ?? 'ONLINE'
      );
    } catch (error) {
      this.logFailure(error);
      return 'OFFLINE';
    }
  }

  public async connectVisitor(
    businessId: string,
    visitorId: string,
    socketId: string,
  ): Promise<void> {
    await this.refreshVisitor(businessId, visitorId, socketId);
  }

  public async refreshVisitor(
    businessId: string,
    visitorId: string,
    socketId: string,
  ): Promise<void> {
    try {
      const key = this.visitorSocketsKey(businessId, visitorId);
      const now = Date.now();
      await this.redis
        .multi()
        .zremrangebyscore(key, 0, now)
        .zadd(key, now + this.ttlSeconds * 1000, socketId)
        .expire(key, this.ttlSeconds * 2)
        .exec();
    } catch (error) {
      this.logFailure(error);
    }
  }

  public async disconnectVisitor(
    businessId: string,
    visitorId: string,
    socketId: string,
  ): Promise<boolean> {
    try {
      const key = this.visitorSocketsKey(businessId, visitorId);
      await this.redis.zrem(key, socketId);
      return (await this.redis.zcard(key)) > 0;
    } catch (error) {
      this.logFailure(error);
      return false;
    }
  }

  public async isVisitorOnline(businessId: string, visitorId: string): Promise<boolean> {
    try {
      const key = this.visitorSocketsKey(businessId, visitorId);
      await this.redis.zremrangebyscore(key, 0, Date.now());
      return (await this.redis.zcard(key)) > 0;
    } catch (error) {
      this.logFailure(error);
      return false;
    }
  }

  private agentSocketsKey(businessId: string, profileId: string): string {
    return `presence:agent:${businessId}:${profileId}:sockets`;
  }
  private agentStateKey(businessId: string, profileId: string): string {
    return `presence:agent:${businessId}:${profileId}:state`;
  }
  private visitorSocketsKey(businessId: string, visitorId: string): string {
    return `presence:visitor:${businessId}:${visitorId}:sockets`;
  }
  private logFailure(error: unknown): void {
    this.logger.warn(
      `Redis presence unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
