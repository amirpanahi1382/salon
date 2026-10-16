import { Equals, IsString, MaxLength, MinLength } from 'class-validator';
import { BANK_TRANSFER_ATTESTATION } from './payment-instructions';

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
