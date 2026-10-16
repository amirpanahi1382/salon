import { CanActivate, Injectable } from '@nestjs/common';
import { NotFoundError } from '@salon/shared';
import { AppConfigService } from '../infrastructure/config/app-config.service';

/**
 * Closes new payment instructions, uploads, submissions, and review decisions.
 * Status, pending review, and audited image reads do not use this guard.
 */
@Injectable()
export class ManualTransferEnabledGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(): boolean {
    if (!this.config.values.MANUAL_TRANSFER_ENABLED) {
      throw new NotFoundError();
    }
    return true;
  }
}
