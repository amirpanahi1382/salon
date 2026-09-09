import type { MessageFailureCode } from '@salon/shared';

export type SendTextCommand = {
  requestId: string;
  phoneNumber: string;
  text: string;
  signal?: AbortSignal;
};

export type SendTextResult =
  | { outcome: 'sent'; providerMessageId: string }
  | { outcome: 'retryable'; code: MessageFailureCode; retryAfterMs?: number }
  | { outcome: 'failed'; code: MessageFailureCode };

export interface CustomerMessageSender {
  sendText(command: SendTextCommand): Promise<SendTextResult>;
}

export class RetryableMessageSendError extends Error {
  readonly code: MessageFailureCode;
  readonly retryAfterMs?: number;

  constructor(code: MessageFailureCode, retryAfterMs?: number) {
    super(code);
    this.name = 'RetryableMessageSendError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}
