import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '@salon/shared';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateSalonProfileDto } from './salon.dto';
import { GetSalonOverallPerformanceUseCase } from './get-salon-overall-performance.use-case';
import { GetSalonProfileUseCase } from './get-salon-profile.use-case';
import { UpdateSalonProfileUseCase } from './update-salon-profile.use-case';

@ApiTags('salon')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('salon')
export class SalonController {
  constructor(
    private readonly getSalonProfile: GetSalonProfileUseCase,
    private readonly getSalonOverallPerformance: GetSalonOverallPerformanceUseCase,
    private readonly updateSalonProfile: UpdateSalonProfileUseCase,
  ) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Get the authenticated salon profile' })
  getProfile(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.getSalonProfile.execute(user);
  }

  @Get('overall-performance')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({
    summary:
      'All-time factual salon counts: customers, SENT customer messages, SENT VIP messages, ReturnCommitments, unique message-associated returned customers, unique customers with two or more Visits. Derived on read. Not causal.',
  })
  overallPerformance(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.getSalonOverallPerformance.execute(user);
  }

  @Patch()
  @Roles('OWNER')
  @ApiOperation({ summary: 'Update the authenticated salon profile' })
  updateProfile(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body() body: UpdateSalonProfileDto,
  ) {
    return this.updateSalonProfile.execute(user, body);
  }
}
