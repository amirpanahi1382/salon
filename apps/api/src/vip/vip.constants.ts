export const VIP_IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const VIP_IMPORT_FIELD = 'file';
export const VIP_SAMPLE_WORK_FIELD = 'file';
export const VIP_SAMPLE_WORK_MAX_BYTES = 5 * 1024 * 1024;
export const VIP_IMPORT_TX_TIMEOUT_MS = 20_000;
export const VIP_DISPATCH_TX_TIMEOUT_MS = 20_000;
export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const VIP_EXPORT_FILENAME = 'vip-outreach.xlsx';
export const VIP_EXPORT_SHEET_NAME = 'VIP';
export const VIP_EXPORT_HEADERS = ['نام', 'شماره تلفن', 'تمپلیت'] as const;

export const VIP_LIST_IMPORT_OPERATION = 'VIP_LIST_IMPORT';
export const VIP_LIST_PATCH_OPERATION = 'VIP_LIST_PATCH';
export const VIP_ENTITLEMENT_GRANT_OPERATION = 'VIP_ENTITLEMENT_GRANT';
export const VIP_ENTITLEMENT_REVOKE_OPERATION = 'VIP_ENTITLEMENT_REVOKE';
export const VIP_REQUEST_CREATE_OPERATION = 'VIP_REQUEST_CREATE';
export const VIP_SAMPLE_WORK_UPLOAD_OPERATION = 'VIP_SAMPLE_WORK_UPLOAD';
export const VIP_REQUEST_SUBMIT_OPERATION = 'VIP_REQUEST_SUBMIT';
export const VIP_DISPATCH_MANUAL_OPERATION = 'VIP_DISPATCH_MANUAL';
export const VIP_DISPATCH_BALE_OPERATION = 'VIP_DISPATCH_BALE';
