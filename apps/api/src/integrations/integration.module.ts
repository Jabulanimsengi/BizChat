import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConversationModule } from '../conversations/conversation.module';
import { ConversationTimelineModule } from '../conversations/conversation-timeline.module';
import { CustomerIdentityModule } from './customer-identity.service';
import {
  IntegrationController,
  IntegrationDocumentationController,
  IntegrationSettingsController,
} from './integration.controller';
import { IntegrationKeyService } from './integration-key.service';
import { IntegrationGuard } from './integration.guard';
import { IntegrationService } from './integration.service';
import { WebhookService } from './webhook.service';
import { WebhookTransport } from './webhook-transport';
import { IntakeModule } from '../intake/intake.module';
import { BusinessHoursModule } from '../business-hours/business-hours.module';
import { AvailabilityService } from './availability.service';
@Module({
  imports: [
    AuthModule,
    ConversationModule,
    ConversationTimelineModule,
    CustomerIdentityModule,
    IntakeModule,
    BusinessHoursModule,
  ],
  controllers: [
    IntegrationController,
    IntegrationSettingsController,
    IntegrationDocumentationController,
  ],
  providers: [
    IntegrationService,
    IntegrationKeyService,
    IntegrationGuard,
    WebhookService,
    WebhookTransport,
    AvailabilityService,
  ],
})
export class IntegrationModule {}
