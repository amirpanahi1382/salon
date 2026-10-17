import { CanActivate, Injectable } from '@nestjs/common';
import { NotFoundError } from '@salon/shared';
import { AppConfigService } from '../infrastructure/config/app-config.service';

/**
 * Email registration is closed in every public registration mode.
 */
@Injectable()
export class EmailRegistrationGuard implements CanActivate {
  constructor(private readonly _config: AppConfigService) {}

  canActivate(): boolean {
    throw new NotFoundError();
  }
}
