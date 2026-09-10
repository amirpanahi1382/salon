import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { SignOptions } from 'jsonwebtoken';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { LoginUseCase } from './login.use-case';
import { PlatformAdminAuthController } from './platform-admin-auth.controller';
import { PlatformAdminLoginUseCase } from './platform-admin-login.use-case';
import { RegisterSalonOwnerUseCase } from './register-salon-owner.use-case';
import { PlatformAdminGuard } from '../infrastructure/auth/platform-admin.guard';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.values.JWT_SECRET,
        signOptions: {
          expiresIn: config.values.JWT_EXPIRES_IN as SignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController, PlatformAdminAuthController],
  providers: [
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    PlatformAdminGuard,
    RegisterSalonOwnerUseCase,
    LoginUseCase,
    PlatformAdminLoginUseCase,
  ],
  exports: [JwtAuthGuard, RolesGuard, PlatformAdminGuard],
})
export class AuthModule {}
