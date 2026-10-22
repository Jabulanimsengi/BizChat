import { Body, Controller, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { WidgetBootstrapResponse } from '@bizchat/types';
import { widgetBootstrapSchema, type WidgetBootstrapInput } from '@bizchat/validation';
import type { Request } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { WidgetService } from './widget.service';

@Controller('widget')
export class WidgetController {
  public constructor(private readonly widgets: WidgetService) {}

  @Post('bootstrap')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  public bootstrap(
    @Body(new ZodValidationPipe(widgetBootstrapSchema)) input: WidgetBootstrapInput,
    @Req() request: Request,
  ): Promise<WidgetBootstrapResponse> {
    return this.widgets.bootstrap(input, request.header('origin'), request.header('user-agent'));
  }
}
