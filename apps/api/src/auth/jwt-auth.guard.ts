import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { UnauthenticatedError } from '@salon/shared';
import { isObservable, lastValueFrom } from 'rxjs';
import { enforceSalonSessionAccess } from './salon-session-access';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const result = super.canActivate(context);
    const allowed = await (isObservable(result) ? lastValueFrom(result) : Promise.resolve(result));
    if (!allowed) {
      return false;
    }
    enforceSalonSessionAccess(this.reflector, context);
    return true;
  }

  override handleRequest<TUser>(err: Error | null, user: TUser): TUser {
    if (err || !user) {
      throw err instanceof Error ? err : new UnauthenticatedError();
    }
    return user;
  }
}
