import { Body, Controller, Get, Headers, Param, Post, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedPrincipal, PlatformAdminPrincipal } from '@salon/shared';
import type { Request } from 'express';
import { AllowOnboardingSession } from '../auth/salon-session-access';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentPlatformAdmin } from '../infrastructure/auth/current-platform-admin.decorator';
import { CurrentUser } from '../infrastructure/auth/current-user.decorator';
import { PlatformAdminGuard } from '../infrastructure/auth/platform-admin.guard';
import { Roles } from '../infrastructure/auth/roles.decorator';
import { RolesGuard } from '../infrastructure/auth/roles.guard';
import { requireIdempotencyKey } from '../infrastructure/http/idempotency';
import { UuidParam } from '../infrastructure/http/uuid-param';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { AgreementAcceptanceEnabledGuard } from './agreement-enabled.guard';
import { AcceptAgreementDto, PresentAgreementDto } from './agreement.dto';
import {
  AcceptAgreementUseCase,
  AgreementDocumentUseCase,
  AgreementReceiptUseCase,
  ExportAgreementEvidenceUseCase,
  GetCurrentAgreementUseCase,
  PresentAgreementUseCase,
  PublishAgreementVersionUseCase,
} from './agreement.use-cases';
import { readTechnicalContext } from './technical-context';

@ApiTags('agreement')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
@AllowOnboardingSession()
@Controller('agreement')
export class AgreementController {
  constructor(
    private readonly current: GetCurrentAgreementUseCase,
    private readonly present: PresentAgreementUseCase,
    private readonly accept: AcceptAgreementUseCase,
    private readonly receipt: AgreementReceiptUseCase,
    private readonly document: AgreementDocumentUseCase,
    private readonly config: AppConfigService,
  ) {}

  @Get('current')
  @UseGuards(AgreementAcceptanceEnabledGuard)
  @ApiOperation({
    summary:
      'Published contract for an AWAITING_AGREEMENT phone owner. Viewing this is not acceptance.',
  })
  getCurrent(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.current.execute(user);
  }

  @Post('presentations')
  @UseGuards(AgreementAcceptanceEnabledGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Render the current contract with the four declared fields. This records a presentation, not acceptance.',
  })
  presentContract(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body() body: PresentAgreementDto,
    @Req() req: Request,
  ) {
    return this.present.execute(user, body, requestIdOf(req));
  }

  @Post('acceptance')
  @UseGuards(AgreementAcceptanceEnabledGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Accept the presented contract and move the salon to AWAITING_PAYMENT. Does not activate the product or show payment instructions.',
  })
  acceptContract(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body() body: AcceptAgreementDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Req() req: Request,
  ) {
    return this.accept.execute(
      user,
      body,
      requireIdempotencyKey(idempotencyKey),
      readTechnicalContext(
        req,
        {
          trustedProxyHops: this.config.values.TRUSTED_PROXY_HOPS,
          trustedProxyIps: this.config.values.TRUSTED_PROXY_IPS,
        },
        this.config.values.API_REVISION,
      ),
    );
  }

  @Get('acceptance/receipt')
  @ApiOperation({
    summary: 'Version, server timestamp, and digest of the accepted contract. Not a payment instruction.',
  })
  getReceipt(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.receipt.execute(user);
  }

  @Get('acceptance/document')
  @ApiOperation({ summary: 'Canonical UTF-8 bytes of the accepted contract.' })
  async download(@CurrentUser() user: AuthenticatedPrincipal): Promise<StreamableFile> {
    const file = await this.document.execute(user);
    return new StreamableFile(file.text, {
      type: 'text/plain; charset=utf-8',
      disposition: 'attachment; filename="accepted-contract.txt"',
    });
  }

  @Get('acceptance/document.html')
  @ApiOperation({ summary: 'HTML rendering of the accepted contract with user text escaped.' })
  async downloadHtml(@CurrentUser() user: AuthenticatedPrincipal): Promise<StreamableFile> {
    const file = await this.document.execute(user);
    return new StreamableFile(file.html, {
      type: 'text/html; charset=utf-8',
      disposition: 'attachment; filename="accepted-contract.html"',
    });
  }
}

@ApiTags('admin-agreement')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin/agreements')
export class AdminAgreementController {
  constructor(
    private readonly publish: PublishAgreementVersionUseCase,
    private readonly evidence: ExportAgreementEvidenceUseCase,
  ) {}

  @Post('versions/publish')
  @UseGuards(AgreementAcceptanceEnabledGuard)
  @ApiOperation({
    summary:
      'Publish the source-controlled CONTRACT_V1. Does not run at startup and does not change a salon.',
  })
  publishVersion(@CurrentPlatformAdmin() admin: PlatformAdminPrincipal) {
    return this.publish.execute(admin);
  }

  @Get('acceptances/:id/evidence')
  @ApiOperation({
    summary:
      'Audited evidence export for one acceptance. It does not include other tenants, OTP codes, or passwords.',
  })
  exportEvidence(
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Param('id', UuidParam) id: string,
    @Req() req: Request,
  ) {
    return this.evidence.execute(admin, id, requestIdOf(req));
  }
}

function requestIdOf(req: Request): string {
  const id = (req as Request & { id?: string }).id;
  return typeof id === 'string' && id.length > 0 ? id : 'unknown';
}
