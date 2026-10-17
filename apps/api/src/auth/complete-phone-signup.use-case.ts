import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma } from '@salon/database';
import {
  ConflictError,
  NotFoundError,
  SignupVerificationFailedError,
  ValidationError,
  createId,
  type SalonAccessState,
} from '@salon/shared';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { assertSameIdempotentRequest, requireIdempotencyKey } from '../infrastructure/http/idempotency';
import { provisionSalonOwner } from './provision-salon-owner';
import { ConsumeSignupProofUseCase, lockSignupPhone } from './phone-signup.use-cases';
import { normalizeIranianMobile, signupCompletionHash, signupPhoneHash } from './signup-phone';

const COMPLETION_CONFLICT = 'An account cannot be created from this signup proof.';

type CompletionBody = {
  userId: string;
  salonId: string;
  role: 'OWNER';
  accessState: SalonAccessState;
};

@Injectable()
export class CompletePhoneSignupUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly consumeProof: ConsumeSignupProofUseCase,
  ) {}

  async execute(input: {
    phone: string;
    signupProof: string;
    salonName: string;
    ownerName: string;
    password: string;
    passwordConfirmation: string;
    idempotencyKey: string | string[] | undefined;
  }): Promise<CompletionBody> {
    const secret = this.config.values.PHONE_SIGNUP_HASH_SECRET;
    if (!this.config.values.PHONE_SIGNUP_ENABLED || !secret) {
      throw new NotFoundError();
    }
    const phone = normalizeIranianMobile(input.phone);
    if (!phone) {
      throw new ValidationError('Enter an Iranian mobile number.');
    }
    if (input.password !== input.passwordConfirmation) {
      throw new ValidationError('Enter the same password in both fields.');
    }
    const salonName = input.salonName.trim();
    const ownerName = input.ownerName.trim();
    if (!salonName || !ownerName) {
      throw new ValidationError('Enter the salon and owner name.');
    }
    if (input.signupProof.length < 20) {
      throw new SignupVerificationFailedError('Signup proof is not valid.');
    }
    const key = requireIdempotencyKey(input.idempotencyKey);
    const requestHash = signupCompletionHash(secret, {
      phone,
      salonName,
      ownerName,
      password: input.password,
      proof: input.signupProof,
    });
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    try {
      return await this.prisma.client.$transaction(
        (tx) =>
          this.complete(tx, {
            phone,
            proof: input.signupProof,
            salonName,
            ownerName,
            passwordHash,
            key,
            requestHash,
            secret,
          }),
        { maxWait: 5_000, timeout: 15_000 },
      );
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = uniqueTarget(error);
        if (target.includes('idempotency')) {
          return this.prisma.client.$transaction(
            (tx) =>
              this.complete(tx, {
                phone,
                proof: input.signupProof,
                salonName,
                ownerName,
                passwordHash,
                key,
                requestHash,
                secret,
              }),
            { maxWait: 5_000, timeout: 15_000 },
          );
        }
        throw new ConflictError(COMPLETION_CONFLICT);
      }
      if (error instanceof Error && error.message.includes('phone_identity_cross_role')) {
        throw new ConflictError(COMPLETION_CONFLICT);
      }
      throw error;
    }
  }

  private async complete(
    tx: Prisma.TransactionClient,
    input: {
      phone: string;
      proof: string;
      salonName: string;
      ownerName: string;
      passwordHash: string;
      key: string;
      requestHash: string;
      secret: string;
    },
  ): Promise<CompletionBody> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`phone-owner-completion:${input.key}`})::bigint)`;
    await lockSignupPhone(tx, signupPhoneHash(input.secret, input.phone));

    const existing = await tx.phoneOwnerCompletion.findUnique({
      where: { idempotencyKey: input.key },
    });
    if (existing) {
      assertSameIdempotentRequest(existing.requestHash, input.requestHash);
      const salon = await tx.salon.findUnique({
        where: { id: existing.salonId },
        select: { accessState: true },
      });
      if (!salon) {
        throw new NotFoundError();
      }
      return {
        userId: existing.userId,
        salonId: existing.salonId,
        role: 'OWNER',
        accessState: salon.accessState,
      };
    }

    await this.consumeProof.execute(input.proof, input.phone, tx);
    const salonId = createId();
    const userId = createId();
    const now = new Date();
    await provisionSalonOwner(tx, {
      salonId,
      userId,
      salonName: input.salonName,
      ownerName: input.ownerName,
      passwordHash: input.passwordHash,
      email: null,
      phone: input.phone,
      accessState: 'AWAITING_AGREEMENT',
      additionalUsersAllowed: false,
      now,
    });
    await tx.phoneOwnerCompletion.create({
      data: {
        id: createId(),
        idempotencyKey: input.key,
        requestHash: input.requestHash,
        salonId,
        userId,
      },
    });
    return {
      userId,
      salonId,
      role: 'OWNER',
      accessState: 'AWAITING_AGREEMENT',
    };
  }
}

function uniqueTarget(error: Prisma.PrismaClientKnownRequestError): string {
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.join(',');
  }
  return typeof target === 'string' ? target : '';
}
