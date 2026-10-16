import {
  CONTRACT_PAYMENT_AMOUNT_LABEL,
  MANUAL_TRANSFER_CARD_NUMBER,
  MANUAL_TRANSFER_CARDHOLDER_NAME,
  formatIrrAmountLabel,
  paymentInstructionsForAcceptance,
} from './payment-instructions';

describe('manual transfer instructions', () => {
  it('formats the accepted CONTRACT_V1 amount and ignores a different snapshot', () => {
    expect(formatIrrAmountLabel('50000000.00')).toBe(CONTRACT_PAYMENT_AMOUNT_LABEL);
    const instructions = paymentInstructionsForAcceptance({
      amountIrr: '50000000.00',
      versionKey: 'CONTRACT_V1',
      acceptanceId: 'acceptance',
      versionId: 'version',
    });
    expect(instructions).toMatchObject({
      cardNumber: MANUAL_TRANSFER_CARD_NUMBER,
      cardholderName: MANUAL_TRANSFER_CARDHOLDER_NAME,
      amountLabel: '۵۰٬۰۰۰٬۰۰۰ ریال',
      amountIrr: '50000000.00',
      currency: 'IRR',
    });
    expect(paymentInstructionsForAcceptance({
      amountIrr: '1.00',
      versionKey: 'CONTRACT_V1',
      acceptanceId: 'acceptance',
      versionId: 'version',
    })).toBeNull();
    expect(paymentInstructionsForAcceptance({
      amountIrr: '50000000.00',
      versionKey: 'CONTRACT_V2',
      acceptanceId: 'acceptance',
      versionId: 'version',
    })).toBeNull();
  });
});
