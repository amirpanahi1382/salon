import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '@salon/shared';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateSalonProfileDto } from './salon.dto';
import { GetSalonProfileUseCase } from './get-salon-profile.use-case';
import { UpdateSalonProfileUseCase } from './update-salon-profile.use-case';

@ApiTags('salon')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('salon')
export class SalonController {
  constructor(
    private readonly getSalonProfile: GetSalonProfileUseCase,
    private readonly updateSalonProfile: UpdateSalonProfileUseCase,
  ) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Get the authenticated salon profile' })
  getProfile(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.getSalonProfile.execute(user);
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
