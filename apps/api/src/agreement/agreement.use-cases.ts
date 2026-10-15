import { Injectable } from '@nestjs/common';
import { Prisma } from '@salon/database';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  createId,
  isPlatformAdminPrincipal,
  type AuthenticatedPrincipal,
  type PlatformAdminPrincipal,
} from '@salon/shared';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import {
  assertSameIdempotentRequest,
  claimIdempotencyKey,
  findIdempotencyRecord,
  hashIdempotencyPayload,
} from '../infrastructure/http/idempotency';
import {
  agreementHtmlDocument,
  assertContractV1Intact,
  renderContract,
  sha256Bytes,
  sha256Utf8,
  type AgreementScopeSnapshot,
  type ContractV1Parts,
  type DeclaredAgreementFields,
} from './contract-document';
import { normalizeDeclaredFields } from './declared-fields';
import { decryptEvidence, encryptEvidence, loadEvidenceKeyRing, type EvidenceKeyRing } from './evidence-cipher';
import type { TechnicalContext } from './technical-context';

const ACCEPT_OPERATION = 'agreement.accept';
const PHONE_MISMATCH = 'The presented phone is not the verified account number.';

type Snapshot = {
  versionKey: string;
  templateDigest: string;
  renderedDigest: string;
  canonicalDocument: string;
  declaredFields: DeclaredAgreementFields & {
    fullNameVerification: 'user-declared';
    nationalIdVerification: 'user-declared';
    salonNameVerification: 'user-declared';
    authorityToContract: 'user-declared';
  };
  checkboxWording: string;
  buttonWording: string;
  explicitConsent: true;
  amountIrr: string;
  scope: AgreementScopeSnapshot;
  observedSocketIp: string | null;
  clientIp: string | null;
  clientIpSource: 'socket' | 'trusted_proxy';
};

@Injectable()
export class PublishAgreementVersionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(admin: PlatformAdminPrincipal) {
    this.assertEnabled();
    const contract = assertContractV1Intact();
    const existing = await this.prisma.client.agreementVersion.findUnique({
      where: { versionKey: contract.versionKey },
    });
    if (existing) {
      if (existing.templateDigest !== contract.templateDigest || existing.canonicalText !== contract.canonicalText) {
        throw new ConflictError('A published agreement version cannot be changed.');
      }
      return publishedBody(existing);
    }
    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        const version = await tx.agreementVersion.create({
          data: {
            id: createId(),
            versionKey: contract.versionKey,
            templateDigest: contract.templateDigest,
            canonicalText: contract.canonicalText,
            checkboxWording: contract.checkboxWording,
            buttonWording: contract.buttonWording,
            amountIrr: new Prisma.Decimal(contract.scope.amountIrr),
            scopeSnapshot: contract.scope,
            publishedByAdminId: admin.adminId,
          },
        });
        await tx.auditLog.create({
          data: {
            id: createId(),
            actorId: null,
            action: 'AGREEMENT_VERSION_PUBLISHED',
            resource: 'agreement_version',
            resourceId: version.id,
            result: 'SUCCESS',
            metadata: {
              versionKey: version.versionKey,
              templateDigest: version.templateDigest,
              publishedByAdminId: admin.adminId,
            },
          },
        });
        return version;
      });
      return publishedBody(created);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.client.agreementVersion.findUnique({
          where: { versionKey: contract.versionKey },
        });
        if (raced && raced.templateDigest === contract.templateDigest) {
          return publishedBody(raced);
        }
        throw new ConflictError('A published agreement version cannot be changed.');
      }
      throw error;
    }
  }

  private assertEnabled(): void {
    if (!this.config.values.AGREEMENT_ACCEPTANCE_ENABLED) {
      throw new NotFoundError();
    }
  }
}

@Injectable()
export class GetCurrentAgreementUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(principal: AuthenticatedPrincipal) {
    assertAgreementEnabled(this.config);
    await assertPhoneOwner(this.prisma, principal, 'AWAITING_AGREEMENT');
    const version = await currentVersion(this.prisma);
    const user = await this.prisma.client.user.findFirst({
      where: { id: principal.userId, salonId: principal.tenantId },
      select: { phone: true },
    });
    const contract = assertContractV1Intact();
    if (version.templateDigest !== contract.templateDigest || version.versionKey !== contract.versionKey) {
      throw new NotFoundError('No agreement is available.');
    }
    return {
      versionKey: version.versionKey,
      templateDigest: version.templateDigest,
      amountIrr: contract.scope.amountIrr,
      amountLabel: contract.scope.amountPhrase,
      checkboxWording: version.checkboxWording,
      buttonWording: version.buttonWording,
      verifiedPhone: user?.phone ?? null,
      declaredFieldNote: 'user-declared',
      segments: contract.segments,
    };
  }
}

@Injectable()
export class PresentAgreementUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    input: { fullName: string; nationalId: string; salonName: string; phone: string },
    requestId: string,
  ) {
    assertAgreementEnabled(this.config);
    const owner = await assertPhoneOwner(this.prisma, principal, 'AWAITING_AGREEMENT');
    const fields = normalizeDeclaredFields(input, owner.phone);
    const contract = assertContractV1Intact();
    const version = await currentVersion(this.prisma);
    if (version.versionKey !== contract.versionKey || version.templateDigest !== contract.templateDigest) {
      throw new NotFoundError('No agreement is available.');
    }
    const canonicalDocument = renderContract(contract.canonicalText, fields);
    const renderedDigest = sha256Utf8(canonicalDocument);
    const presentationId = createId();
    const ring = loadEvidenceKeyRing(this.config.values);
    const declared = encryptEvidence(
      ring,
      `agreement-presentation-fields:${presentationId}`,
      Buffer.from(JSON.stringify(fields), 'utf8'),
    );
    const rendered = encryptEvidence(
      ring,
      `agreement-presentation-document:${presentationId}`,
      Buffer.from(canonicalDocument, 'utf8'),
    );
    const nowRows = await this.prisma.client.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS now
    `;
    const now = nowRows[0]?.now ?? new Date();
    const expiresAt = new Date(now.getTime() + this.config.values.AGREEMENT_PRESENTATION_TTL_SECONDS * 1000);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.agreementPresentation.create({
        data: {
          id: presentationId,
          salonId: principal.tenantId,
          userId: principal.userId,
          versionId: version.id,
          renderedDigest,
          evidenceKeyId: declared.keyId,
          declaredFieldsCiphertext: declared.ciphertext,
          declaredFieldsNonce: declared.nonce,
          renderedDocumentCiphertext: rendered.ciphertext,
          renderedDocumentNonce: rendered.nonce,
          expiresAt,
        },
      });
      await tx.auditLog.create({
        data: {
          id: createId(),
          tenantId: principal.tenantId,
          actorId: principal.userId,
          action: 'AGREEMENT_DOCUMENT_PRESENTED',
          resource: 'agreement_presentation',
          resourceId: presentationId,
          result: 'SUCCESS',
          metadata: {
            versionKey: version.versionKey,
            templateDigest: version.templateDigest,
            renderedDigest,
            requestId,
          },
        },
      });
    });
    return {
      presentationId,
      versionKey: version.versionKey,
      templateDigest: version.templateDigest,
      renderedDigest,
      amountIrr: contract.scope.amountIrr,
      amountLabel: contract.scope.amountPhrase,
      checkboxWording: version.checkboxWording,
      buttonWording: version.buttonWording,
      canonicalDocument,
      expiresAt: expiresAt.toISOString(),
    };
  }
}

@Injectable()
export class AcceptAgreementUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    input: { presentationId: string; accepted: boolean },
    idempotencyKey: string,
    context: TechnicalContext,
  ) {
    assertAgreementEnabled(this.config);
    if (input.accepted !== true) {
      throw new ConflictError('Agreement acceptance requires the confirmation checkbox.');
    }
    if (!principal.sessionId) {
      throw new UnauthenticatedError('Sign in again before accepting the agreement.');
    }
    const requestHash = hashIdempotencyPayload(
      ACCEPT_OPERATION,
      `${input.presentationId}|accepted`,
    );
    const acceptanceId = createId();
    try {
      return await this.prisma.client.$transaction(
        (tx) => this.accept(tx, principal, input.presentationId, idempotencyKey, requestHash, acceptanceId, context),
        { maxWait: 5_000, timeout: 15_000 },
      );
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.client.$transaction(
          (tx) => this.accept(tx, principal, input.presentationId, idempotencyKey, requestHash, acceptanceId, context),
          { maxWait: 5_000, timeout: 15_000 },
        );
      }
      throw error;
    }
  }

  private async accept(
    tx: Prisma.TransactionClient,
    principal: AuthenticatedPrincipal,
    presentationId: string,
    idempotencyKey: string,
    requestHash: string,
    acceptanceId: string,
    context: TechnicalContext,
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agreement-accept:${principal.tenantId}`})::bigint)`;
    await tx.$queryRaw`
      SELECT id FROM salons WHERE id = ${principal.tenantId}::uuid FOR UPDATE
    `;
    const claim = await claimIdempotencyKey(tx, {
      id: createId(),
      tenantId: principal.tenantId,
      actorId: principal.userId,
      operation: ACCEPT_OPERATION,
      key: idempotencyKey,
      requestHash,
      resourceType: 'agreement_acceptance',
      resourceId: acceptanceId,
    });
    if (!claim.inserted) {
      const existing = await findIdempotencyRecord(tx, {
        tenantId: principal.tenantId,
        actorId: principal.userId,
        operation: ACCEPT_OPERATION,
        key: idempotencyKey,
      });
      if (!existing) {
        throw new ConflictError('Agreement acceptance could not be replayed.');
      }
      assertSameIdempotentRequest(existing.requestHash, requestHash);
      const prior = await tx.agreementAcceptance.findFirst({
        where: { id: existing.resourceId, salonId: principal.tenantId },
      });
      if (!prior) {
        throw new ConflictError('Agreement acceptance could not be replayed.');
      }
      return acceptanceBody(prior, true);
    }

    const salon = await tx.salon.findUnique({
      where: { id: principal.tenantId },
      select: { accessState: true, status: true },
    });
    if (!salon || salon.status !== 'ACTIVE' || salon.accessState !== 'AWAITING_AGREEMENT') {
      throw new ConflictError('This salon is not waiting for agreement acceptance.');
    }
    const user = await tx.user.findFirst({
      where: {
        id: principal.userId,
        salonId: principal.tenantId,
        role: 'OWNER',
        status: 'ACTIVE',
      },
      select: { phone: true },
    });
    if (!user?.phone) {
      throw new ForbiddenError('This agreement is for a phone-owned salon.');
    }
    const contract = assertContractV1Intact();
    const version = await tx.agreementVersion.findFirst({
      where: { versionKey: contract.versionKey },
      orderBy: { publishedAt: 'desc' },
    });
    if (!version || version.templateDigest !== contract.templateDigest) {
      throw new NotFoundError('No agreement is available.');
    }
    const presentation = await tx.agreementPresentation.findFirst({
      where: { id: presentationId, salonId: principal.tenantId, userId: principal.userId },
    });
    if (!presentation) {
      throw new NotFoundError('Agreement presentation not found');
    }
    if (presentation.versionId !== version.id) {
      throw new ConflictError('The contract version changed. Review the current contract.');
    }
    const clock = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const acceptedAt = clock[0]?.now;
    if (!acceptedAt || presentation.expiresAt <= acceptedAt) {
      throw new ConflictError('This contract preview has expired. Review the contract again.');
    }
    const ring = loadEvidenceKeyRing(this.config.values);
    const fields = JSON.parse(
      decryptEvidence(
        ring,
        presentation.evidenceKeyId,
        Buffer.from(presentation.declaredFieldsNonce),
        Buffer.from(presentation.declaredFieldsCiphertext),
        `agreement-presentation-fields:${presentation.id}`,
      ).toString('utf8'),
    ) as DeclaredAgreementFields;
    if (fields.phone !== user.phone) {
      throw new ConflictError(PHONE_MISMATCH);
    }
    const canonicalDocument = renderContract(contract.canonicalText, fields);
    const renderedDigest = sha256Utf8(canonicalDocument);
    if (renderedDigest !== presentation.renderedDigest) {
      throw new ConflictError('The presented document does not match this contract.');
    }
    const storedDocument = decryptEvidence(
      ring,
      presentation.evidenceKeyId,
      Buffer.from(presentation.renderedDocumentNonce),
      Buffer.from(presentation.renderedDocumentCiphertext),
      `agreement-presentation-document:${presentation.id}`,
    ).toString('utf8');
    if (storedDocument !== canonicalDocument) {
      throw new ConflictError('The presented document does not match this contract.');
    }
    const completion = await tx.phoneOwnerCompletion.findUnique({
      where: { userId: principal.userId },
      select: { id: true, salonId: true },
    });
    const snapshot = snapshotOf(contract, canonicalDocument, renderedDigest, fields, context);
    const snapshotBytes = Buffer.from(JSON.stringify(snapshot), 'utf8');
    const encrypted = encryptEvidence(
      ring,
      `agreement-acceptance-snapshot:${acceptanceId}`,
      snapshotBytes,
    );
    await tx.agreementAcceptance.create({
      data: {
        id: acceptanceId,
        salonId: principal.tenantId,
        userId: principal.userId,
        versionId: version.id,
        presentationId: presentation.id,
        templateDigest: version.templateDigest,
        renderedDigest,
        snapshotDigest: sha256Bytes(snapshotBytes),
        checkboxWording: version.checkboxWording,
        buttonWording: version.buttonWording,
        checkboxConfirmed: true,
        phoneOwnerCompletionId: completion?.salonId === principal.tenantId ? completion.id : null,
        acceptedAt,
        sessionJti: principal.sessionId as string,
        clientIp: context.clientIp,
        clientIpSource: context.clientIpSource,
        userAgent: context.userAgent,
        appVersion: context.appVersion,
        appBuild: context.appBuild,
        apiRevision: context.apiRevision,
        requestId: context.requestId,
        correlationId: context.correlationId,
        amountIrr: new Prisma.Decimal(contract.scope.amountIrr),
        scopeSnapshot: contract.scope,
        evidenceKeyId: encrypted.keyId,
        snapshotCiphertext: encrypted.ciphertext,
        snapshotNonce: encrypted.nonce,
      },
    });
    const updated = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE salons
      SET access_state = 'AWAITING_PAYMENT', updated_at = clock_timestamp()
      WHERE id = ${principal.tenantId}::uuid
        AND access_state = 'AWAITING_AGREEMENT'
      RETURNING id
    `;
    if (updated.length !== 1) {
      throw new ConflictError('This salon is not waiting for agreement acceptance.');
    }
    await tx.auditLog.create({
      data: {
        id: createId(),
        tenantId: principal.tenantId,
        actorId: principal.userId,
        action: 'AGREEMENT_DOCUMENT_ACCEPTED',
        resource: 'agreement_acceptance',
        resourceId: acceptanceId,
        result: 'SUCCESS',
        metadata: {
          versionKey: version.versionKey,
          templateDigest: version.templateDigest,
          renderedDigest,
          presentationId: presentation.id,
          sessionId: principal.sessionId,
          requestId: context.requestId,
          correlationId: context.correlationId,
          accessState: 'AWAITING_PAYMENT',
        },
      },
    });
    const stored = await tx.agreementAcceptance.findFirstOrThrow({
      where: { id: acceptanceId, salonId: principal.tenantId },
    });
    return acceptanceBody(stored, false);
  }
}

@Injectable()
export class AgreementReceiptUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(principal: AuthenticatedPrincipal) {
    const acceptance = await this.prisma.client.agreementAcceptance.findFirst({
      where: { salonId: principal.tenantId, userId: principal.userId },
      orderBy: { acceptedAt: 'desc' },
      include: { version: { select: { versionKey: true } } },
    });
    if (!acceptance) {
      throw new NotFoundError('Accepted agreement not found');
    }
    return {
      acceptanceId: acceptance.id,
      versionKey: acceptance.version.versionKey,
      templateDigest: acceptance.templateDigest,
      renderedDigest: acceptance.renderedDigest,
      acceptedAt: acceptance.acceptedAt.toISOString(),
      statement: 'Agreement recorded. Payment instructions are not available.',
    };
  }
}

@Injectable()
export class AgreementDocumentUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(principal: AuthenticatedPrincipal): Promise<{ text: Buffer; html: Buffer }> {
    const acceptance = await this.ownedAcceptance(principal);
    const snapshot = decryptSnapshot(loadEvidenceKeyRing(this.config.values), acceptance);
    const text = Buffer.from(snapshot.canonicalDocument, 'utf8');
    if (sha256Bytes(text) !== acceptance.renderedDigest) {
      throw new ConflictError('The stored agreement document does not match its digest.');
    }
    return {
      text,
      html: Buffer.from(agreementHtmlDocument(snapshot.canonicalDocument), 'utf8'),
    };
  }

  private async ownedAcceptance(principal: AuthenticatedPrincipal) {
    const acceptance = await this.prisma.client.agreementAcceptance.findFirst({
      where: { salonId: principal.tenantId, userId: principal.userId },
      orderBy: { acceptedAt: 'desc' },
    });
    if (!acceptance) {
      throw new NotFoundError('Accepted agreement not found');
    }
    return acceptance;
  }
}

@Injectable()
export class ExportAgreementEvidenceUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(admin: PlatformAdminPrincipal, acceptanceId: string, requestId: string) {
    if (!isPlatformAdminPrincipal(admin)) {
      throw new ForbiddenError();
    }
    const acceptance = await this.prisma.client.agreementAcceptance.findUnique({
      where: { id: acceptanceId },
      include: { version: true },
    });
    if (!acceptance) {
      throw new NotFoundError('Accepted agreement not found');
    }
    const ring = loadEvidenceKeyRing(this.config.values);
    const snapshot = decryptSnapshot(ring, acceptance);
    assertTechnicalEvidence(snapshot, acceptance);
    const documentBytes = Buffer.from(snapshot.canonicalDocument, 'utf8');
    const rerender = renderContract(acceptance.version.canonicalText, {
      fullName: snapshot.declaredFields.fullName,
      nationalId: snapshot.declaredFields.nationalId,
      salonName: snapshot.declaredFields.salonName,
      phone: snapshot.declaredFields.phone,
    });
    await this.prisma.client.auditLog.create({
      data: {
        id: createId(),
        tenantId: acceptance.salonId,
        actorId: null,
        action: 'AGREEMENT_EVIDENCE_EXPORTED',
        resource: 'agreement_acceptance',
        resourceId: acceptance.id,
        result: 'SUCCESS',
        metadata: {
          exportedByAdminId: admin.adminId,
          requestId,
          templateDigest: acceptance.templateDigest,
          renderedDigest: acceptance.renderedDigest,
        },
      },
    });
    return {
      verification: {
        statement:
          'This is an application copy of database rows. It is not WORM storage, not an independent timestamp, not a certified electronic signature, and not a determination of court admissibility.',
        howToVerify: [
          'Decode canonicalDocument as UTF-8 and compute SHA-256. It must equal renderedDocumentSha256.',
          'Compute SHA-256 of the published template canonicalText. It must equal templateSha256.',
          'Compare versionKey with the source-controlled contract of that key. A later version does not replace this row.',
          'The national ID, name, salon name, and authority to contract are user-declared. This export does not independently verify them.',
          'observedSocketIp is the API socket peer. clientIp equals that socket unless the peer was one of TRUSTED_PROXY_IPS and the forwarded chain matched TRUSTED_PROXY_HOPS. A client-supplied X-Forwarded-For is not verified evidence. userAgent, appVersion, and appBuild are client-reported and are not the socket address.',
        ],
        notImplemented: [
          'Article 1 names the provider only as the owner of the application. No legal entity is recorded here.',
          'The 500 counted-send engine is not implemented.',
          'Recipient-consent evidence for contact transfer is not implemented.',
          'Payment, receipt review, product activation, and campaign start are not part of this record.',
        ],
      },
      hashManifest: {
        algorithm: 'SHA-256',
        templateSha256: acceptance.templateDigest,
        renderedDocumentSha256: acceptance.renderedDigest,
        snapshotSha256: acceptance.snapshotDigest,
        recomputedRenderedSha256: sha256Bytes(documentBytes),
        rerenderMatchesStoredDocument: rerender === snapshot.canonicalDocument,
      },
      version: {
        versionKey: acceptance.version.versionKey,
        templateDigest: acceptance.version.templateDigest,
        canonicalText: acceptance.version.canonicalText,
        amountIrr: acceptance.amountIrr.toFixed(2),
        scope: acceptance.scopeSnapshot,
      },
      acceptance: {
        id: acceptance.id,
        salonId: acceptance.salonId,
        userId: acceptance.userId,
        presentationId: acceptance.presentationId,
        phoneOwnerCompletionId: acceptance.phoneOwnerCompletionId,
        acceptedAt: acceptance.acceptedAt.toISOString(),
        sessionJti: acceptance.sessionJti,
        checkboxWording: acceptance.checkboxWording,
        buttonWording: acceptance.buttonWording,
        checkboxConfirmed: acceptance.checkboxConfirmed,
        explicitConsent: snapshot.explicitConsent,
      },
      declaredFields: snapshot.declaredFields,
      canonicalDocument: snapshot.canonicalDocument,
      technicalContext: {
        observedSocketIp: snapshot.observedSocketIp,
        clientIp: acceptance.clientIp,
        clientIpSource: acceptance.clientIpSource,
        clientIpIsObservedSocket: acceptance.clientIpSource === 'socket',
        forwardedClientIpVerified: acceptance.clientIpSource === 'trusted_proxy',
        userAgent: acceptance.userAgent,
        appVersion: acceptance.appVersion,
        appBuild: acceptance.appBuild,
        apiRevision: acceptance.apiRevision,
        requestId: acceptance.requestId,
        correlationId: acceptance.correlationId,
        appVersionIsClientReported: true,
        appBuildIsClientReported: true,
        userAgentIsClientReported: true,
        clientReported: {
          userAgent: acceptance.userAgent,
          appVersion: acceptance.appVersion,
          appBuild: acceptance.appBuild,
        },
      },
    };
  }
}

function assertAgreementEnabled(config: AppConfigService): void {
  if (!config.values.AGREEMENT_ACCEPTANCE_ENABLED) {
    throw new NotFoundError();
  }
}

async function assertPhoneOwner(
  prisma: PrismaService,
  principal: AuthenticatedPrincipal,
  accessState: 'AWAITING_AGREEMENT',
): Promise<{ phone: string }> {
  if (principal.role !== 'OWNER' || principal.accessState !== accessState) {
    throw new ForbiddenError('This account cannot accept the agreement.');
  }
  const user = await prisma.client.user.findFirst({
    where: {
      id: principal.userId,
      salonId: principal.tenantId,
      role: 'OWNER',
      status: 'ACTIVE',
      salon: { status: 'ACTIVE', accessState },
    },
    select: { phone: true },
  });
  if (!user?.phone) {
    throw new ForbiddenError('This agreement is for a phone-owned salon.');
  }
  return { phone: user.phone };
}

async function currentVersion(prisma: PrismaService) {
  const contract = assertContractV1Intact();
  const version = await prisma.client.agreementVersion.findUnique({
    where: { versionKey: contract.versionKey },
  });
  if (!version) {
    throw new NotFoundError('No agreement is available.');
  }
  return version;
}

function publishedBody(version: {
  id: string;
  versionKey: string;
  templateDigest: string;
  publishedAt: Date;
}) {
  return {
    id: version.id,
    versionKey: version.versionKey,
    templateDigest: version.templateDigest,
    publishedAt: version.publishedAt.toISOString(),
  };
}

function acceptanceBody(
  acceptance: { id: string; templateDigest: string; renderedDigest: string; acceptedAt: Date },
  replayed: boolean,
) {
  return {
    acceptanceId: acceptance.id,
    accessState: 'AWAITING_PAYMENT' as const,
    versionKey: 'CONTRACT_V1',
    templateDigest: acceptance.templateDigest,
    renderedDigest: acceptance.renderedDigest,
    acceptedAt: acceptance.acceptedAt.toISOString(),
    replayed,
    statement: 'Agreement recorded. Payment instructions are not available.',
  };
}

function snapshotOf(
  contract: ContractV1Parts,
  canonicalDocument: string,
  renderedDigest: string,
  fields: DeclaredAgreementFields,
  context: TechnicalContext,
): Snapshot {
  return {
    versionKey: contract.versionKey,
    templateDigest: contract.templateDigest,
    renderedDigest,
    canonicalDocument,
    declaredFields: {
      ...fields,
      fullNameVerification: 'user-declared',
      nationalIdVerification: 'user-declared',
      salonNameVerification: 'user-declared',
      authorityToContract: 'user-declared',
    },
    checkboxWording: contract.checkboxWording,
    buttonWording: contract.buttonWording,
    explicitConsent: true,
    amountIrr: contract.scope.amountIrr,
    scope: contract.scope,
    observedSocketIp: context.observedSocketIp,
    clientIp: context.clientIp,
    clientIpSource: context.clientIpSource,
  };
}

function assertTechnicalEvidence(
  snapshot: Snapshot,
  acceptance: { clientIp: string | null; clientIpSource: string },
): void {
  const storedClientIp = acceptance.clientIp ?? null;
  if (snapshot.clientIp !== storedClientIp || snapshot.clientIpSource !== acceptance.clientIpSource) {
    throw new ConflictError('The stored agreement snapshot does not match its technical context.');
  }
  if (snapshot.clientIpSource === 'socket' && snapshot.clientIp !== snapshot.observedSocketIp) {
    throw new ConflictError('The stored agreement snapshot does not match its technical context.');
  }
  if (
    snapshot.clientIpSource === 'trusted_proxy' &&
    (!snapshot.observedSocketIp || snapshot.observedSocketIp === snapshot.clientIp)
  ) {
    throw new ConflictError('The stored agreement snapshot does not match its technical context.');
  }
}

function decryptSnapshot(
  ring: EvidenceKeyRing,
  acceptance: {
    id: string;
    evidenceKeyId: string;
    snapshotNonce: Uint8Array;
    snapshotCiphertext: Uint8Array;
    snapshotDigest: string;
  },
): Snapshot {
  const bytes = decryptEvidence(
    ring,
    acceptance.evidenceKeyId,
    Buffer.from(acceptance.snapshotNonce),
    Buffer.from(acceptance.snapshotCiphertext),
    `agreement-acceptance-snapshot:${acceptance.id}`,
  );
  if (sha256Bytes(bytes) !== acceptance.snapshotDigest) {
    throw new ConflictError('The stored agreement snapshot does not match its digest.');
  }
  return JSON.parse(bytes.toString('utf8')) as Snapshot;
}
