import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '@salon/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import { UuidParam } from '../infrastructure/http/uuid-param';
import { ChangeUserRoleUseCase } from './change-user-role.use-case';
import { ChangeUserStatusUseCase } from './change-user-status.use-case';
import { CreateSalonUserUseCase } from './create-salon-user.use-case';
import { GetSalonUserUseCase } from './get-salon-user.use-case';
import { ListSalonUsersUseCase } from './list-salon-users.use-case';
import { ChangeUserRoleDto, ChangeUserStatusDto, CreateSalonUserDto } from './user.dto';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UserController {
  constructor(
    private readonly listSalonUsers: ListSalonUsersUseCase,
    private readonly getSalonUser: GetSalonUserUseCase,
    private readonly createSalonUser: CreateSalonUserUseCase,
    private readonly changeUserRole: ChangeUserRoleUseCase,
    private readonly changeUserStatus: ChangeUserStatusUseCase,
  ) {}

  @Get()
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'List users in the authenticated salon' })
  list(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.listSalonUsers.execute(user);
  }

  @Post()
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Create a user in the authenticated salon' })
  create(@CurrentUser() user: AuthenticatedPrincipal, @Body() body: CreateSalonUserDto) {
    return this.createSalonUser.execute(user, body);
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Get a user in the authenticated salon' })
  getById(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', UuidParam) id: string,
  ) {
    return this.getSalonUser.execute(user, id);
  }

  @Patch(':id/role')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Change a salon user role' })
  updateRole(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', UuidParam) id: string,
    @Body() body: ChangeUserRoleDto,
  ) {
    return this.changeUserRole.execute(user, id, body);
  }

  @Patch(':id/status')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Activate or deactivate a salon user' })
  updateStatus(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', UuidParam) id: string,
    @Body() body: ChangeUserStatusDto,
  ) {
    return this.changeUserStatus.execute(user, id, body);
  }
}
