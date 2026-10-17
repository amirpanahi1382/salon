import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@salon/shared';
import type { RegisterSalonOwnerDto } from './auth.dto';

/**
 * Email registration is closed. Public salon creation is phone signup only.
 */
@Injectable()
export class RegisterSalonOwnerUseCase {
  execute(_input: RegisterSalonOwnerDto): Promise<never> {
    throw new NotFoundError();
  }
}
