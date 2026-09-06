/** Excel customer import limits. Synchronous processing; no persistent import records. */
export const CUSTOMER_IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const CUSTOMER_IMPORT_MAX_ROWS = 5000;
/** createMany chunks inside one all-or-nothing transaction. */
export const CUSTOMER_IMPORT_WRITE_CHUNK = 250;
/** Parse stays outside the TX. 20s covers 5k inserts + outbox without unbounded lock time. */
export const CUSTOMER_IMPORT_TX_TIMEOUT_MS = 20_000;
export const CUSTOMER_IMPORT_MAX_ZIP_ENTRIES = 64;
export const CUSTOMER_IMPORT_MAX_UNCOMPRESSED_BYTES = 8 * 1024 * 1024;
export const CUSTOMER_IMPORT_MAX_UNCOMPRESSED_MEMBER_BYTES = 4 * 1024 * 1024;
export const CUSTOMER_IMPORT_MAX_SHEETS = 8;
export const CUSTOMER_IMPORT_MAX_CELL_CHARS = 256;
export const CUSTOMER_IMPORT_FIELD = 'file';
export const CUSTOMER_IMPORT_TEMPLATE_FILENAME = 'customer-import-template.xlsx';
export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
