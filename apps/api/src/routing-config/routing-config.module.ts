import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IntakeModule } from '../intake/intake.module';
import { IntakeFormAdminService } from './intake-form-admin.service';
import { RoutingConfigController } from './routing-config.controller';
import { RoutingSettingsService } from './routing-settings.service';
import { SkillService } from './skill.service';
import { TopicService } from './topic.service';

/** Tenant routing configuration: skills, topics, pre-chat forms, and routing settings. */
@Module({
  imports: [AuthModule, IntakeModule],
  controllers: [RoutingConfigController],
  providers: [SkillService, RoutingSettingsService, TopicService, IntakeFormAdminService],
})
export class RoutingConfigModule {}
