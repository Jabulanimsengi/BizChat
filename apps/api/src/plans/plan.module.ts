import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlanController, PlatformController } from './plan.controller';
import { PlanService } from './plan.service';
import { PlatformAdminGuard } from './platform-admin.guard';

/** Global: limits are checked wherever tenants create conversations, users, keys, or webhooks. */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [PlanController, PlatformController],
  providers: [PlanService, PlatformAdminGuard],
  exports: [PlanService],
})
export class PlanModule {}
