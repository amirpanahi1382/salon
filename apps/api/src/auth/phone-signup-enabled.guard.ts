import { CanActivate, Injectable } from '@nestjs/common';
import { NotFoundError } from '@salon/shared';
import { AppConfigService } from '../infrastructure/config/app-config.service';

/** Hides the phone-signup routes until PHONE_SIGNUP_ENABLED is set. Runs before body validation. */
@Injectable()
export class PhoneSignupEnabledGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(): boolean {
    if (!this.config.values.PHONE_SIGNUP_ENABLED) {
      throw new NotFoundError();
    }
    return true;
  }
}
