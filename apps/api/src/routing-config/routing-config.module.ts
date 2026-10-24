import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IntakeModule } from '../intake/intake.module';
import { RoutingConfigController } from './routing-config.controller';
import { RoutingSettingsService } from './routing-settings.service';
import { SkillService } from './skill.service';
import { TopicService } from './topic.service';

/** Tenant routing configuration: skills, topics, and routing settings. */
@Module({
  imports: [AuthModule, IntakeModule],
  controllers: [RoutingConfigController],
  providers: [SkillService, RoutingSettingsService, TopicService],
})
export class RoutingConfigModule {}
