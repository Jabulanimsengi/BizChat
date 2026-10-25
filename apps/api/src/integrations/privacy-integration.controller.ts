import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { VisitorDataExport, VisitorErasureResponse } from '@bizchat/types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrivacyService } from '../privacy/privacy.service';
import {
  customerErasureSchema,
  customerPrivacySchema,
  type CustomerPrivacyInput,
} from './integration.contracts';
import { IntegrationGuard, IntegrationScopeRequired } from './integration.guard';
import { SetupContextService, type SetupRequest } from './setup.controller';

/** Data subject requests (POPIA) for customers known by your own external ID. */
@Controller('integrations/privacy')
@UseGuards(IntegrationGuard)
export class PrivacyIntegrationController {
  public constructor(
    private readonly context: SetupContextService,
    private readonly privacy: PrivacyService,
  ) {}

  /** Everything held about one customer, for an access request. */
  @Post('customers/export')
  @HttpCode(200)
  @IntegrationScopeRequired('privacy:read')
  public async export(
    @Req() request: SetupRequest,
    @Body(new ZodValidationPipe(customerPrivacySchema)) input: CustomerPrivacyInput,
  ): Promise<VisitorDataExport> {
    return this.privacy.export(
      await this.context.auth(request),
      { externalId: input.externalId },
      request.requestId,
      request.ip,
    );
  }

  /** Deletes a customer's conversations, attachments, and identity. Cannot be undone. */
  @Post('customers/erase')
  @HttpCode(200)
  @IntegrationScopeRequired('privacy:write')
  public async erase(
    @Req() request: SetupRequest,
    @Body(new ZodValidationPipe(customerErasureSchema)) input: CustomerPrivacyInput,
  ): Promise<VisitorErasureResponse> {
    return this.privacy.erase(
      await this.context.auth(request),
      { externalId: input.externalId },
      request.requestId,
      request.ip,
    );
  }
}
