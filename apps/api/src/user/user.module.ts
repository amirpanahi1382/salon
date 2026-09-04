import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChangeUserRoleUseCase } from './change-user-role.use-case';
import { ChangeUserStatusUseCase } from './change-user-status.use-case';
import { CreateSalonUserUseCase } from './create-salon-user.use-case';
import { GetSalonUserUseCase } from './get-salon-user.use-case';
import { ListSalonUsersUseCase } from './list-salon-users.use-case';
import { UserController } from './user.controller';

@Module({
  imports: [AuthModule],
  controllers: [UserController],
  providers: [
    ListSalonUsersUseCase,
    GetSalonUserUseCase,
    CreateSalonUserUseCase,
    ChangeUserRoleUseCase,
    ChangeUserStatusUseCase,
  ],
})
export class UserModule {}
