import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { OPPORTUNITY_TYPES, type OpportunityType } from '@salon/shared';

@Injectable()
export class OpportunityTypeParamPipe implements PipeTransform<string, OpportunityType> {
  transform(value: string): OpportunityType {
    if (!OPPORTUNITY_TYPES.includes(value as OpportunityType)) {
      throw new BadRequestException('Invalid opportunity type');
    }
    return value as OpportunityType;
  }
}

export const OpportunityTypeParam = new OpportunityTypeParamPipe();
