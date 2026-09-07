import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '@salon/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import { UuidParam } from '../infrastructure/http/uuid-param';
import { CreateServiceUseCase } from './create-service.use-case';
import { ListServicesUseCase } from './list-services.use-case';
import { CreateServiceDto, ListServicesQueryDto, UpdateServiceDto } from './service.dto';
import { UpdateServiceUseCase } from './update-service.use-case';

@ApiTags('services')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('services')
export class ServiceController {
  constructor(
    private readonly createService: CreateServiceUseCase,
    private readonly listServices: ListServicesUseCase,
    private readonly updateService: UpdateServiceUseCase,
  ) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'List salon services. Default: ACTIVE only. OWNER may pass includeInactive=true.' })
  list(@CurrentUser() user: AuthenticatedPrincipal, @Query() query: ListServicesQueryDto) {
    return this.listServices.execute(user, query);
  }

  @Post()
  @Roles('OWNER')
  @ApiOperation({ summary: 'Create a salon service' })
  create(@CurrentUser() user: AuthenticatedPrincipal, @Body() body: CreateServiceDto) {
    return this.createService.execute(user, body);
  }

  @Patch(':id')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Update a salon service name or status' })
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', UuidParam) id: string,
    @Body() body: UpdateServiceDto,
  ) {
    return this.updateService.execute(user, id, body);
  }
}
