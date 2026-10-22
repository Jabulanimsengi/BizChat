import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { OriginGuard } from '../auth/origin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { AuthContext } from '../common/http.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { IntegrationKeyService } from './integration-key.service';
import { IntegrationService } from './integration.service';
import { CustomerIdentityService } from './customer-identity.service';
import { WebhookService } from './webhook.service';
import {
  IntegrationGuard,
  IntegrationScopeRequired,
  type IntegrationRequest,
} from './integration.guard';
import {
  customerSchema,
  historySchema,
  keySchema,
  pageSchema,
  resolveSchema,
  sendSchema,
  startSchema,
  webhookSchema,
  type HistoryInput,
  type KeyInput,
  type PageInput,
  type ResolveInput,
  type SendInput,
  type StartInput,
  type WebhookInput,
} from './integration.contracts';
import { integrationOpenApi } from './integration.openapi';

@Controller('integration-settings')
@UseGuards(SessionAuthGuard, AuthorizationGuard, OriginGuard)
@RequirePermissions('settings:manage')
export class IntegrationSettingsController {
  public constructor(
    private readonly keys: IntegrationKeyService,
    private readonly webhooks: WebhookService,
  ) {}
  @Get('keys')
  public list(@CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.keys.list(auth.business.id);
  }
  @Post('keys')
  @Header('Cache-Control', 'no-store')
  public create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(keySchema)) input: KeyInput,
  ): Promise<unknown> {
    return this.keys.create(auth, input);
  }
  @Post('keys/:id/revoke')
  @HttpCode(204)
  public revoke(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.keys.revoke(auth, id);
  }
  @Post('keys/:id/rotate')
  @Header('Cache-Control', 'no-store')
  public rotate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.keys.rotate(auth, id);
  }
  @Get('webhooks')
  public endpoints(@CurrentAuth() auth: AuthContext): Promise<unknown> {
    return this.webhooks.list(auth.business.id);
  }
  @Post('webhooks')
  @Header('Cache-Control', 'no-store')
  public endpoint(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(webhookSchema)) input: WebhookInput,
  ): Promise<unknown> {
    return this.webhooks.create(auth, input);
  }
  @Post('webhooks/:id/disable')
  @HttpCode(204)
  public disable(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.webhooks.disable(auth, id);
  }
  @Get('webhooks/:id/deliveries')
  public deliveries(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<unknown> {
    return this.webhooks.deliveries(auth.business.id, id);
  }
  @Post('deliveries/:id/replay')
  @HttpCode(204)
  public replay(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.webhooks.replay(auth, id);
  }
}

@Controller('integrations')
@UseGuards(IntegrationGuard)
export class IntegrationController {
  public constructor(
    private readonly service: IntegrationService,
    private readonly identities: CustomerIdentityService,
  ) {}
  @Get('conversations')
  @IntegrationScopeRequired('conversations:read')
  public list(
    @Req() request: IntegrationRequest,
    @Query(new ZodValidationPipe(pageSchema)) query: PageInput,
  ): Promise<object> {
    return this.service.list(request.integration, query);
  }
  @Get('conversations/:id')
  @IntegrationScopeRequired('conversations:read')
  public get(
    @Req() request: IntegrationRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<object> {
    return this.service.get(request.integration, id);
  }
  @Get('conversations/:id/messages')
  @IntegrationScopeRequired('messages:read')
  public history(
    @Req() request: IntegrationRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(historySchema)) query: HistoryInput,
  ): Promise<object> {
    return this.service.history(request.integration, id, query);
  }
  @Post('conversations')
  @IntegrationScopeRequired('conversations:write')
  public start(
    @Req() request: IntegrationRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(startSchema)) input: StartInput,
  ): Promise<unknown> {
    return this.service.start(request.integration, key, input);
  }
  @Post('conversations/:id/messages')
  @IntegrationScopeRequired('messages:write')
  public send(
    @Req() request: IntegrationRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(sendSchema)) input: SendInput,
  ): Promise<unknown> {
    return this.service.send(request.integration, id, key, input);
  }
  @Post('conversations/:id/resolve')
  @HttpCode(200)
  @IntegrationScopeRequired('conversations:write')
  public resolve(
    @Req() request: IntegrationRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(resolveSchema)) input: ResolveInput,
  ): Promise<unknown> {
    return this.service.resolve(request.integration, id, key, input);
  }
  @Post('customers/identify')
  @IntegrationScopeRequired('customers:identify')
  public identify(
    @Req() request: IntegrationRequest,
    @Body(new ZodValidationPipe(customerSchema)) input: { externalId: string },
  ): Promise<object> {
    return this.identities.issue(request.integration, input.externalId);
  }
}
@Controller('integrations')
export class IntegrationDocumentationController {
  @Get('openapi.json')
  public openapi(): object {
    return integrationOpenApi;
  }
}
