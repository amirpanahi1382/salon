import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GetOpportunitiesWorkspaceUseCase } from './get-opportunities-workspace.use-case';
import { OpportunitiesController } from './opportunities.controller';
import { OpportunitiesWorkspaceRepository } from './opportunities-workspace.repository';

@Module({
  imports: [AuthModule],
  controllers: [OpportunitiesController],
  providers: [GetOpportunitiesWorkspaceUseCase, OpportunitiesWorkspaceRepository],
})
export class OpportunitiesModule {}
