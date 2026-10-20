import { Equals, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { BANK_TRANSFER_ATTESTATION } from './payment-instructions';

export const ACTIVATION_RECEIPT_LIST_PHASES = ['UNDER_REVIEW', 'APPROVED', 'REJECTED'] as const;
export type ActivationReceiptListPhase = (typeof ACTIVATION_RECEIPT_LIST_PHASES)[number];

export class ListActivationReceiptsQueryDto {
  @IsOptional()
  @IsIn([...ACTIVATION_RECEIPT_LIST_PHASES])
  phase?: ActivationReceiptListPhase;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export class ApproveActivationReceiptDto {
  @IsString()
  @Equals(BANK_TRANSFER_ATTESTATION)
  bankAttestation!: string;
}

export class RejectActivationReceiptDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
