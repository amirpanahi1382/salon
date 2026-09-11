import { hashIdempotencyPayload } from '../infrastructure/http/idempotency';
import {
  VIP_DISPATCH_BALE_OPERATION,
  VIP_DISPATCH_MANUAL_OPERATION,
  VIP_ENTITLEMENT_GRANT_OPERATION,
  VIP_ENTITLEMENT_REVOKE_OPERATION,
  VIP_LIST_IMPORT_OPERATION,
  VIP_LIST_PATCH_OPERATION,
  VIP_REQUEST_CREATE_OPERATION,
  VIP_REQUEST_SUBMIT_OPERATION,
  VIP_SAMPLE_WORK_UPLOAD_OPERATION,
} from './vip.constants';

export {
  VIP_DISPATCH_BALE_OPERATION,
  VIP_DISPATCH_MANUAL_OPERATION,
  VIP_ENTITLEMENT_GRANT_OPERATION,
  VIP_ENTITLEMENT_REVOKE_OPERATION,
  VIP_LIST_IMPORT_OPERATION,
  VIP_LIST_PATCH_OPERATION,
  VIP_REQUEST_CREATE_OPERATION,
  VIP_REQUEST_SUBMIT_OPERATION,
  VIP_SAMPLE_WORK_UPLOAD_OPERATION,
};

export function vipListImportHash(contactCount: number, phonesFingerprint: string): string {
  return hashIdempotencyPayload(VIP_LIST_IMPORT_OPERATION, `${contactCount}:${phonesFingerprint}`);
}

export function vipListPatchHash(listId: string, name: string, availability: string): string {
  return hashIdempotencyPayload(VIP_LIST_PATCH_OPERATION, `${listId}:${name}:${availability}`);
}

export function vipEntitlementHash(salonId: string, action: 'grant' | 'revoke'): string {
  return hashIdempotencyPayload(
    action === 'grant' ? VIP_ENTITLEMENT_GRANT_OPERATION : VIP_ENTITLEMENT_REVOKE_OPERATION,
    `${action}:${salonId}`,
  );
}

export function vipRequestCreateHash(
  listId: string,
  requestedCount: number,
  geographicRange: string,
): string {
  return hashIdempotencyPayload(
    VIP_REQUEST_CREATE_OPERATION,
    `${listId}:${requestedCount}:${geographicRange}`,
  );
}

export function vipSampleWorkHash(requestId: string, sha256: string): string {
  return hashIdempotencyPayload(VIP_SAMPLE_WORK_UPLOAD_OPERATION, `${requestId}:${sha256}`);
}

export function vipRequestSubmitHash(requestId: string): string {
  return hashIdempotencyPayload(VIP_REQUEST_SUBMIT_OPERATION, requestId);
}

export function vipDispatchHash(requestId: string, mode: 'MANUAL' | 'BALE'): string {
  return hashIdempotencyPayload(
    mode === 'MANUAL' ? VIP_DISPATCH_MANUAL_OPERATION : VIP_DISPATCH_BALE_OPERATION,
    `${requestId}:${mode}`,
  );
}
