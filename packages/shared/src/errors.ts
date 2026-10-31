export type AppErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'CUSTOMER_PHONE_EXISTS'
  | 'MESSAGE_DAILY_LIMIT_REACHED'
  | 'GLOBAL_MESSAGE_STOP'
  | 'RETURN_COMMITMENT_VISIT_REVIEW_REQUIRED'
  | 'RATE_LIMITED'
  | 'SIGNUP_SEND_UNCONFIRMED'
  | 'SIGNUP_VERIFICATION_UNCONFIRMED'
  | 'SIGNUP_RESEND_COOLDOWN'
  | 'SIGNUP_SEND_LIMIT'
  | 'SIGNUP_VERIFICATION_FAILED'
  | 'SIGNUP_VERIFICATION_LIMIT'
  | 'SIGNUP_PROOF_ALREADY_ISSUED'
  | 'SIGNUP_PROOF_EXPIRED'
  | 'SIGNUP_CHALLENGE_SUPERSEDED'
  | 'SIGNUP_CHALLENGE_EXPIRED'
  | 'AGREEMENT_PHONE_UNVERIFIED'
  | 'BUSINESS_RULE'
  | 'INFRASTRUCTURE_ERROR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(
    code: AppErrorCode,
    message: string,
    statusCode: number,
    details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationError';
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHENTICATED', message, 401);
    this.name = 'UnauthenticatedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Not permitted') {
    super('FORBIDDEN', message, 403);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super('NOT_FOUND', message, 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super('CONFLICT', message, 409, details);
    this.name = 'ConflictError';
  }
}

/** The submitted phone is not the OTP-verified account phone. This is not a phone-change flow. */
export class AgreementPhoneUnverifiedError extends AppError {
  constructor() {
    super(
      'AGREEMENT_PHONE_UNVERIFIED',
      'This number is not the verified account number. A different number has to be verified before it can be used.',
      409,
    );
    this.name = 'AgreementPhoneUnverifiedError';
  }
}

/** The salon already has this phone. The response does not include the other customer's details. */
export class CustomerPhoneExistsError extends AppError {
  constructor(
    message = 'A customer with this phone number already exists in this salon. Choose that customer explicitly.',
  ) {
    super('CUSTOMER_PHONE_EXISTS', message, 409);
    this.name = 'CustomerPhoneExistsError';
  }
}

export class MessageDailyLimitError extends AppError {
  constructor(message = 'A message was already requested for this customer today') {
    super('MESSAGE_DAILY_LIMIT_REACHED', message, 409);
    this.name = 'MessageDailyLimitError';
  }
}

/** Salon-facing refusal. Does not name another salon, list, or the stop reason. */
export const GLOBAL_MESSAGE_STOP_MESSAGE = 'ارسال پیام به این شماره مجاز نیست';

export class GlobalMessageStopError extends AppError {
  constructor(message = GLOBAL_MESSAGE_STOP_MESSAGE) {
    super('GLOBAL_MESSAGE_STOP', message, 409);
    this.name = 'GlobalMessageStopError';
  }
}

export const RETURN_COMMITMENT_VISIT_REVIEW_REQUIRED_MESSAGE =
  'A visit after this follow-up is already recorded. Review the existing visit instead of creating another one.';

export class ReturnCommitmentVisitReviewRequiredError extends AppError {
  constructor(message = RETURN_COMMITMENT_VISIT_REVIEW_REQUIRED_MESSAGE) {
    super('RETURN_COMMITMENT_VISIT_REVIEW_REQUIRED', message, 409);
    this.name = 'ReturnCommitmentVisitReviewRequiredError';
  }
}

export class SignupSendUnconfirmedError extends AppError {
  constructor(
    message = 'The signup message was not confirmed. Retrying this same request will not send another message.',
  ) {
    super('SIGNUP_SEND_UNCONFIRMED', message, 409);
    this.name = 'SignupSendUnconfirmedError';
  }
}

export class SignupVerificationUnconfirmedError extends AppError {
  constructor(
    message = 'The verification result was not confirmed. Retrying this same request will not submit the code again.',
  ) {
    super('SIGNUP_VERIFICATION_UNCONFIRMED', message, 409);
    this.name = 'SignupVerificationUnconfirmedError';
  }
}

export class SignupResendCooldownError extends AppError {
  constructor(retryAfterSeconds: number) {
    super(
      'SIGNUP_RESEND_COOLDOWN',
      `Another signup message cannot be sent yet. Try again in ${retryAfterSeconds} seconds.`,
      429,
      { retryAfterSeconds },
    );
    this.name = 'SignupResendCooldownError';
  }
}

export class SignupSendLimitError extends AppError {
  constructor(retryAfterSeconds?: number) {
    super(
      'SIGNUP_SEND_LIMIT',
      'Another signup message cannot be sent yet.',
      429,
      retryAfterSeconds === undefined ? undefined : { retryAfterSeconds },
    );
    this.name = 'SignupSendLimitError';
  }
}

export class SignupVerificationFailedError extends AppError {
  constructor(message = 'The code could not be verified.') {
    super('SIGNUP_VERIFICATION_FAILED', message, 400);
    this.name = 'SignupVerificationFailedError';
  }
}

/** The local attempt budget for this challenge is spent. A fresh code is required. */
export class SignupVerificationLimitError extends AppError {
  constructor(retryAfterSeconds?: number) {
    super(
      'SIGNUP_VERIFICATION_LIMIT',
      'Too many verification attempts for this signup code.',
      429,
      retryAfterSeconds === undefined ? undefined : { retryAfterSeconds },
    );
    this.name = 'SignupVerificationLimitError';
  }
}

export class SignupProofAlreadyIssuedError extends AppError {
  constructor(
    message = 'This verification already returned a signup proof. That proof is not issued again.',
  ) {
    super('SIGNUP_PROOF_ALREADY_ISSUED', message, 409);
    this.name = 'SignupProofAlreadyIssuedError';
  }
}

/** The proof once existed for this phone but its local deadline has passed. */
export class SignupProofExpiredError extends AppError {
  constructor(message = 'This signup proof has expired. Verify the phone again.') {
    super('SIGNUP_PROOF_EXPIRED', message, 409);
    this.name = 'SignupProofExpiredError';
  }
}

export class SignupChallengeSupersededError extends AppError {
  constructor(message = 'This signup request was replaced by a later one.') {
    super('SIGNUP_CHALLENGE_SUPERSEDED', message, 409);
    this.name = 'SignupChallengeSupersededError';
  }
}

export class SignupChallengeExpiredError extends AppError {
  constructor(message = 'This signup request has expired. It will not send another message.') {
    super('SIGNUP_CHALLENGE_EXPIRED', message, 409);
    this.name = 'SignupChallengeExpiredError';
  }
}

export class BusinessRuleError extends AppError {
  constructor(message: string) {
    super('BUSINESS_RULE', message, 409);
    this.name = 'BusinessRuleError';
  }
}

/** Dependency or outbound-call failure. Safe client message; details stay in logs. */
export class InfrastructureError extends AppError {
  constructor(message = 'A required service is temporarily unavailable') {
    super('INFRASTRUCTURE_ERROR', message, 503);
    this.name = 'InfrastructureError';
  }
}
