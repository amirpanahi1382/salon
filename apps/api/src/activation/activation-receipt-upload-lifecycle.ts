/**
 * Private lifecycle boundary for integration harnesses. Production deliberately
 * provides the no-op implementation; it is neither an HTTP capability nor a
 * configuration switch.
 */
export interface ActivationReceiptUploadLifecycle {
  afterObjectVerified(input: { receiptId: string }): Promise<void>;
}

export const ACTIVATION_RECEIPT_UPLOAD_LIFECYCLE = Symbol('ACTIVATION_RECEIPT_UPLOAD_LIFECYCLE');

export const noOpActivationReceiptUploadLifecycle: ActivationReceiptUploadLifecycle = {
  async afterObjectVerified(): Promise<void> {},
};
