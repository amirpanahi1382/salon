import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UnauthenticatedError } from '@salon/shared';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  override handleRequest<TUser>(err: Error | null, user: TUser): TUser {
    if (err || !user) {
      throw err instanceof Error ? err : new UnauthenticatedError();
    }
    return user;
  }
}
