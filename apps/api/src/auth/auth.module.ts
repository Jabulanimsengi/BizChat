import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthorizationGuard } from './authorization.guard';
import { OriginGuard } from './origin.guard';
import { SessionAuthGuard } from './session-auth.guard';
import { SessionAuthenticationService } from './session-authentication.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionAuthenticationService,
    SessionAuthGuard,
    AuthorizationGuard,
    OriginGuard,
  ],
  exports: [SessionAuthenticationService, SessionAuthGuard, AuthorizationGuard, OriginGuard],
})
export class AuthModule {}
