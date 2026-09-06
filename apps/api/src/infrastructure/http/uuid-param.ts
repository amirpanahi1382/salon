import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** RFC 4122 including UUIDv7 from createId(). Invalid values become VALIDATION_ERROR. */
@Injectable()
export class UuidParamPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !UUID_RE.test(value)) {
      throw new BadRequestException('Invalid id');
    }
    return value;
  }
}

export const UuidParam = new UuidParamPipe();
