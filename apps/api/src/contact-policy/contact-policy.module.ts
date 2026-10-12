import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformMessageStopController } from './platform-message-stop.controller';
import { PlatformMessageStopService } from './platform-message-stop.service';

@Module({
  imports: [AuthModule],
  controllers: [PlatformMessageStopController],
  providers: [PlatformMessageStopService],
  exports: [PlatformMessageStopService],
})
export class ContactPolicyModule {}
