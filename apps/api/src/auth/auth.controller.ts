import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  type ForgotPasswordInput,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
  type VerifyEmailInput,
} from '@bizchat/validation';
import type { Request, Response } from 'express';
import { CurrentAuth } from './auth.decorators';
import type { AuthContext, AuthenticatedRequest } from '../common/http.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Environment } from '../config/environment';
import { AuthService } from './auth.service';
import { OriginGuard } from './origin.guard';
import { SESSION_COOKIE, SessionAuthGuard } from './session-auth.guard';

@Controller('auth')
export class AuthController {
  public constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  @Post('register')
  @UseGuards(OriginGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  public async register(
    @Body(new ZodValidationPipe(registerSchema)) input: RegisterInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ authenticated: true }> {
    const session = await this.authService.register(input, this.metadata(request));
    this.setCookie(response, session.token, session.expiresAt);
    return { authenticated: true };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OriginGuard)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  public async login(
    @Body(new ZodValidationPipe(loginSchema)) input: LoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ authenticated: true }> {
    const session = await this.authService.login(input, this.metadata(request));
    this.setCookie(response, session.token, session.expiresAt);
    return { authenticated: true };
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  public me(@CurrentAuth() auth: AuthContext): Omit<AuthContext, 'sessionId'> {
    return { user: auth.user, membership: auth.membership, business: auth.business };
  }

  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(OriginGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  public async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) input: ForgotPasswordInput,
  ): Promise<{ requested: true }> {
    await this.authService.requestPasswordReset(input.email);
    return { requested: true };
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(OriginGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  public async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) input: ResetPasswordInput,
  ): Promise<void> {
    await this.authService.resetPassword(input.token, input.password);
  }

  @Post('email/verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(OriginGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  public async verifyEmail(
    @Body(new ZodValidationPipe(verifyEmailSchema)) input: VerifyEmailInput,
  ): Promise<void> {
    await this.authService.verifyEmail(input.token);
  }

  @Post('email/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(SessionAuthGuard, OriginGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  public async resendVerification(@CurrentAuth() auth: AuthContext): Promise<{ sent: true }> {
    await this.authService.sendVerificationEmail(auth.user.id);
    return { sent: true };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionAuthGuard, OriginGuard)
  public async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(request.auth.sessionId);
    response.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  private metadata(request: Request): { ipAddress?: string; userAgent?: string } {
    return { ipAddress: request.ip, userAgent: request.header('user-agent') };
  }

  private setCookie(response: Response, token: string, expiresAt: Date): void {
    response.cookie(SESSION_COOKIE, token, { ...this.cookieOptions(), expires: expiresAt });
  }

  private cookieOptions(): { httpOnly: true; sameSite: 'lax'; secure: boolean; path: string } {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      path: '/',
    };
  }
}
