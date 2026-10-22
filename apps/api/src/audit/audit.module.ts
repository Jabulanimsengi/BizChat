import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuthModule } from '../auth/auth.module';
import { AuditController } from './audit.controller';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
