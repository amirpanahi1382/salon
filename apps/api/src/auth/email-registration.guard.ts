import { CanActivate, Injectable } from '@nestjs/common';
import { NotFoundError } from '@salon/shared';
import { AppConfigService } from '../infrastructure/config/app-config.service';

/**
 * POST /auth/register exists only in email registration mode.
 * Phone-only and closed modes keep it closed even when OTP signup is off.
 */
@Injectable()
export class EmailRegistrationGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(): boolean {
    if (this.config.values.PUBLIC_REGISTRATION_MODE !== 'email') {
      throw new NotFoundError();
    }
    return true;
  }
}
