import { CustomerIdentityModule } from '../integrations/customer-identity.service';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConversationModule } from '../conversations/conversation.module';
import { WidgetController } from './widget.controller';
import { WidgetGateway } from './widget.gateway';
import { WidgetService } from './widget.service';
import { WidgetSettingsController } from './widget-settings.controller';
import { WidgetSettingsService } from './widget-settings.service';
import { AgentModule } from '../agents/agent.module';
import { RoutingModule } from '../routing/routing.module';
import { IntakeModule } from '../intake/intake.module';

@Module({
  imports: [
    CustomerIdentityModule,
    AuthModule,
    ConversationModule,
    AgentModule,
    RoutingModule,
    IntakeModule,
  ],
  controllers: [WidgetController, WidgetSettingsController],
  providers: [WidgetService, WidgetSettingsService, WidgetGateway],
  exports: [WidgetService],
})
export class WidgetModule {}
