import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BusinessUsersController } from './business-users.controller';
import { BusinessUsersService } from './business-users.service';

@Module({
  imports: [AuthModule],
  controllers: [BusinessUsersController],
  providers: [BusinessUsersService],
})
export class BusinessUsersModule {}
