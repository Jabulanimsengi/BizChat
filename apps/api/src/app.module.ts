import { IntegrationModule } from './integrations/integration.module';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BusinessModule } from './business/business.module';
import {
  resolveThrottlerFailMode,
  validateEnvironment,
  type Environment,
} from './config/environment';
import { DatabaseModule } from './database/database.module';
import { ConversationModule } from './conversations/conversation.module';
import { DomainModule } from './domains/domain.module';
import { HealthModule } from './health/health.module';
import { WidgetModule } from './widget/widget.module';
import { RealtimeModule } from './realtime/realtime.module';
import { AgentModule } from './agents/agent.module';
import { DepartmentModule } from './departments/department.module';
import { RoutingConfigModule } from './routing-config/routing-config.module';
import { RoutingModule } from './routing/routing.module';
import { ConversationToolsModule } from './conversation-tools/conversation-tools.module';
import { BusinessHoursModule } from './business-hours/business-hours.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { PrivacyModule } from './privacy/privacy.module';
import { BusinessUsersModule } from './users/business-users.module';
import { AttachmentModule } from './attachments/attachment.module';
import { MailModule } from './mail/mail.module';
import { MetricsModule } from './metrics/metrics.module';
import { ProxyAwareThrottlerGuard } from './common/proxy-aware-throttler.guard';
import { RedisThrottlerStorage } from './common/redis-throttler.storage';
import { RedisService } from './realtime/redis.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRootAsync({
      imports: [RealtimeModule],
      inject: [RedisService, ConfigService],
      useFactory: (redis: RedisService, config: ConfigService<Environment, true>) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
        storage: new RedisThrottlerStorage(
          redis,
          resolveThrottlerFailMode({
            NODE_ENV: config.get('NODE_ENV', { infer: true }),
            THROTTLER_FAIL_MODE: config.get('THROTTLER_FAIL_MODE', { infer: true }),
          }),
        ),
      }),
    }),
    DatabaseModule,
    IntegrationModule,
    RealtimeModule,
    MailModule,
    MetricsModule,
    AgentModule,
    DepartmentModule,
    RoutingConfigModule,
    RoutingModule,
    ConversationToolsModule,
    BusinessHoursModule,
    AnalyticsModule,
    PrivacyModule,
    BusinessUsersModule,
    AttachmentModule,
    ConversationModule,
    AuditModule,
    AuthModule,
    BusinessModule,
    DomainModule,
    HealthModule,
    WidgetModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ProxyAwareThrottlerGuard }],
})
export class AppModule {}
