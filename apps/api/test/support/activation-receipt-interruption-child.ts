import { ArgumentsHost, CallHandler, Catch, ExecutionContext, Injectable, NestInterceptor, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { S3CompatibleObjectStorage } from '@salon/object-storage';
import { catchError, throwError, type Observable } from 'rxjs';
import { AppModule } from '../../src/app.module';
import {
  ACTIVATION_RECEIPT_UPLOAD_LIFECYCLE,
  type ActivationReceiptUploadLifecycle,
} from '../../src/activation/activation-receipt-upload-lifecycle';
import { AppConfigService } from '../../src/infrastructure/config/app-config.service';
import { HttpExceptionFilter } from '../../src/infrastructure/http/http-exception.filter';
import { OBJECT_STORAGE } from '../../src/infrastructure/storage/object-storage';

async function main(): Promise<void> {
  const token = process.env.ACTIVATION_INTERRUPT_TEST_TOKEN;
  const image = process.env.ACTIVATION_INTERRUPT_TEST_IMAGE_BASE64;
  if (!token || !image || typeof process.send !== 'function') {
    throw new Error('Activation interruption child is missing its private harness inputs');
  }

  let reached = false;
  let wait!: () => void;
  const lifecycle: ActivationReceiptUploadLifecycle = {
    afterObjectVerified: async () => {
      if (reached) throw new Error('Activation interruption lifecycle reached twice');
      reached = true;
      process.send?.({ type: 'activation-receipt-object-verified' });
      await new Promise<void>((resolve) => { wait = resolve; });
    },
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(OBJECT_STORAGE)
    .useFactory({
      inject: [AppConfigService],
      factory: (config: AppConfigService) => new S3CompatibleObjectStorage(config.values),
    })
    .overrideProvider(ACTIVATION_RECEIPT_UPLOAD_LIFECYCLE)
    .useValue(lifecycle)
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalInterceptors(new ChildDiagnosticInterceptor());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  // This child-level wrapper is the active filter for the harness and delegates
  // byte-for-byte response handling to the production filter.
  app.useGlobalFilters(new DiagnosticHttpExceptionFilter());
  try {
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') throw new Error('Activation interruption child could not bind HTTP');
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(image, 'base64')], { type: 'image/jpeg' }), 'receipt.jpg');
    const response = await fetch(`http://127.0.0.1:${address.port}/activation/receipts`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    // The parent terminates this process at the private lifecycle boundary.
    // Any early response proves the test setup failed rather than silently passing.
    if (response.status !== 201) {
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      process.send?.({
        type: 'activation-receipt-child-http-error',
        stage: 'upload-before-object-verified',
        status: response.status,
        requestId: response.headers.get('x-request-id') ?? null,
        errorCode: typeof payload.code === 'string' ? payload.code : null,
      });
      throw new Error(`Activation interruption upload returned HTTP ${response.status}`);
    }
    wait();
  } finally {
    await app.close();
  }
}

@Catch()
class DiagnosticHttpExceptionFilter extends HttpExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const row = exception as { code?: unknown; meta?: { code?: unknown; constraint?: unknown }; cause?: { code?: unknown; constraint?: unknown } };
    const code = typeof row.code === 'string' && /^(P\d{4}|[A-Z_]{3,80})$/.test(row.code) ? row.code : null;
    const rawCode = row.meta?.code ?? row.cause?.code;
    const rawConstraint = row.meta?.constraint ?? row.cause?.constraint;
    const prismaCode = typeof rawCode === 'string' && /^[0-9A-Z]{4,8}$/.test(rawCode) ? rawCode : null;
    const constraint = typeof rawConstraint === 'string' && /^[a-z0-9_]{1,100}$/i.test(rawConstraint) ? rawConstraint : null;
    process.send?.({ type: 'activation-receipt-child-filter', exceptionType: exception instanceof Error ? exception.constructor.name : typeof exception, code, prismaCode, constraint });
    super.catch(exception, host);
  }
}

@Injectable()
class ChildDiagnosticInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(catchError((error: unknown) => {
      const row = error as { code?: unknown; meta?: { code?: unknown; constraint?: unknown } };
      const code = typeof row.code === 'string' && /^(P\d{4}|[A-Z_]{3,80})$/.test(row.code) ? row.code : null;
      const prismaCode = typeof row.meta?.code === 'string' && /^[0-9A-Z]{4,8}$/.test(row.meta.code) ? row.meta.code : null;
      const constraint = typeof row.meta?.constraint === 'string' && /^[a-z0-9_]{1,100}$/i.test(row.meta.constraint)
        ? row.meta.constraint : null;
      process.send?.({
        type: 'activation-receipt-child-exception',
        operation: context.getHandler().name,
        exceptionType: error instanceof Error ? error.constructor.name : typeof error,
        code,
        prismaCode,
        constraint,
      });
      return throwError(() => error);
    }));
  }
}

void main().catch((error: unknown) => {
  process.send?.({ type: 'activation-receipt-child-error', message: error instanceof Error ? error.message : 'unknown' });
  process.exitCode = 1;
});
