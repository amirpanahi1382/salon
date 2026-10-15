import { CanActivate, Injectable } from '@nestjs/common';
import { NotFoundError } from '@salon/shared';
import { AppConfigService } from '../infrastructure/config/app-config.service';

/**
 * Closes publishing, presentation, and new acceptance.
 * Receipt, accepted-document, and admin evidence reads do not use this guard.
 */
@Injectable()
export class AgreementAcceptanceEnabledGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(): boolean {
    if (!this.config.values.AGREEMENT_ACCEPTANCE_ENABLED) {
      throw new NotFoundError();
    }
    return true;
  }
}
