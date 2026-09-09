import { getBaleSafirSettings } from '@salon/config';
import { InfrastructureError, toSafirPhoneNumber } from '@salon/shared';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { fetchWithTimeout } from '../infrastructure/http/outbound-http';
import type { CustomerMessageSender, SendTextCommand, SendTextResult } from './message-sender';
import { mapSafirBody, mapSafirHttpFailure, parseRetryAfterMs } from './safir-error-mapping';

export class BaleSafirMessageSender implements CustomerMessageSender {
  constructor(private readonly config: AppConfigService) {}

  async sendText(command: SendTextCommand): Promise<SendTextResult> {
    const settings = getBaleSafirSettings(this.config.values);
    if (!settings) {
      return { outcome: 'failed', code: 'NOT_CONFIGURED' };
    }
    const phoneNumber = toSafirPhoneNumber(command.phoneNumber);
    if (!phoneNumber) {
      return { outcome: 'failed', code: 'PROVIDER_RECIPIENT_UNAVAILABLE' };
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(`${settings.baseUrl}/send_message`, {
        method: 'POST',
        timeoutMs: settings.timeoutMs,
        signal: command.signal,
        headers: {
          'Content-Type': 'application/json',
          'api-access-key': settings.accessKey,
        },
        body: JSON.stringify({
          request_id: command.requestId,
          bot_id: settings.botId,
          phone_number: phoneNumber,
          message_data: {
            message: {
              text: command.text,
            },
          },
        }),
      });
    } catch (error: unknown) {
      if (error instanceof InfrastructureError) {
        return { outcome: 'retryable', code: 'PROVIDER_TEMPORARY' };
      }
      return { outcome: 'retryable', code: 'PROVIDER_UNKNOWN' };
    }

    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
    if (!response.ok) {
      return mapSafirHttpFailure(response.status, retryAfterMs);
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return { outcome: 'retryable', code: 'PROVIDER_UNKNOWN' };
    }
    const mapped = mapSafirBody(parsed);
    if (mapped.outcome === 'retryable' && retryAfterMs !== undefined) {
      return { ...mapped, retryAfterMs };
    }
    return mapped;
  }
}
