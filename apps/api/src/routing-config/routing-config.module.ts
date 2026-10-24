import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RoutingConfigController } from './routing-config.controller';
import { RoutingSettingsService } from './routing-settings.service';
import { SkillService } from './skill.service';

/** Tenant routing configuration: the skill catalogue and routing settings. */
@Module({
  imports: [AuthModule],
  controllers: [RoutingConfigController],
  providers: [SkillService, RoutingSettingsService],
})
export class RoutingConfigModule {}
