import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import type { AgentProfileResponse } from '@bizchat/types';
import { agentProfileUpdateSchema, type AgentProfileUpdateInput } from '@bizchat/validation';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators';
import { OriginGuard } from '../auth/origin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { AuthContext } from '../common/http.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AgentProfileService } from './agent-profile.service';

@Controller('agent-profile')
@UseGuards(SessionAuthGuard, AuthorizationGuard)
@RequirePermissions('conversation:view_assigned')
export class AgentProfileController {
  public constructor(private readonly profiles: AgentProfileService) {}
  @Get()
  @RequirePermissions('conversation:transfer')
  public list(@CurrentAuth() auth: AuthContext): Promise<AgentProfileResponse[]> {
    return this.profiles.listBusiness(auth.business.id);
  }
  @Get('me') public me(@CurrentAuth() auth: AuthContext): Promise<AgentProfileResponse> {
    return this.profiles.getMine(auth);
  }
  @Patch('me')
  @UseGuards(OriginGuard)
  public update(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(agentProfileUpdateSchema)) input: AgentProfileUpdateInput,
  ): Promise<AgentProfileResponse> {
    return this.profiles.updateMine(auth, input);
  }
}
