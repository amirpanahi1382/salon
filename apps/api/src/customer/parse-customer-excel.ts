import ExcelJS from 'exceljs';
import {
  CUSTOMER_PHONE_RULE_MESSAGE,
  isUsableCustomerPhone,
  splitCustomerDisplayName,
} from '@salon/shared';
import {
  CUSTOMER_IMPORT_MAX_CELL_CHARS,
  CUSTOMER_IMPORT_MAX_ROWS,
  CUSTOMER_IMPORT_MAX_SHEETS,
  CUSTOMER_IMPORT_MAX_UNCOMPRESSED_BYTES,
  CUSTOMER_IMPORT_MAX_UNCOMPRESSED_MEMBER_BYTES,
  CUSTOMER_IMPORT_MAX_ZIP_ENTRIES,
} from './customer-import.constants';

export type CustomerImportRowStatus =
  | 'IMPORTED'
  | 'ALREADY_EXISTS'
  | 'DUPLICATE_IN_FILE'
  | 'INVALID';

export type ParsedCustomerExcelRow =
  | {
      row: number;
      status: 'INVALID';
      errors: string[];
    }
  | {
      row: number;
      firstName: string;
      lastName: string;
      phoneNumber: string;
    };

export type ParsedCustomerExcel = {
  rows: ParsedCustomerExcelRow[];
};

const NAME_HEADERS = new Set(['name']);
const PHONE_HEADERS = new Set(['phone']);

function stringifyCell(value: ExcelJS.CellValue, trimText: boolean): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return '';
    }
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    const text = String(value);
    const clipped = text.length > CUSTOMER_IMPORT_MAX_CELL_CHARS
      ? text.slice(0, CUSTOMER_IMPORT_MAX_CELL_CHARS)
      : text;
    return trimText ? clipped.trim() : clipped;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object' && 'richText' in value) {
    const text = value.richText.map((part) => part.text).join('');
    return trimText ? text.trim() : text;
  }
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') {
    return trimText ? value.text.trim() : value.text;
  }
  if (typeof value === 'object' && 'result' in value) {
    return stringifyCell(value.result as ExcelJS.CellValue, trimText);
  }
  if (typeof value === 'object' && 'formula' in value) {
    return '';
  }
  return '';
}

function cellText(value: ExcelJS.CellValue): string {
  return stringifyCell(value, true);
}

function cellPhoneText(value: ExcelJS.CellValue): string {
  return stringifyCell(value, false);
}

function headerKey(value: string): string {
  return value.trim().toLowerCase();
}

export function assertSafeXlsxZip(buffer: Buffer): void {
  if (buffer.length < 22) {
    throw new Error('MALFORMED');
  }

  const eocd = findZipEocd(buffer);
  if (eocd < 0) {
    throw new Error('MALFORMED');
  }

  const entries = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0 || entries > CUSTOMER_IMPORT_MAX_ZIP_ENTRIES) {
    throw new Error('ZIP_BOMB');
  }
  if (cdOffset + cdSize > buffer.length) {
    throw new Error('MALFORMED');
  }

  let pos = cdOffset;
  let totalUncompressed = 0;
  for (let i = 0; i < entries; i += 1) {
    if (pos + 46 > buffer.length) {
      throw new Error('MALFORMED');
    }
    if (
      buffer[pos] !== 0x50 ||
      buffer[pos + 1] !== 0x4b ||
      buffer[pos + 2] !== 0x01 ||
      buffer[pos + 3] !== 0x02
    ) {
      throw new Error('MALFORMED');
    }
    const uncompressed = buffer.readUInt32LE(pos + 24);
    if (uncompressed === 0xffffffff || uncompressed > CUSTOMER_IMPORT_MAX_UNCOMPRESSED_MEMBER_BYTES) {
      throw new Error('ZIP_BOMB');
    }
    totalUncompressed += uncompressed;
    if (totalUncompressed > CUSTOMER_IMPORT_MAX_UNCOMPRESSED_BYTES) {
      throw new Error('ZIP_BOMB');
    }
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    pos += 46 + nameLen + extraLen + commentLen;
  }
}

function findZipEocd(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 22 - 65535);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (
      buffer[i] === 0x50 &&
      buffer[i + 1] === 0x4b &&
      buffer[i + 2] === 0x05 &&
      buffer[i + 3] === 0x06
    ) {
      return i;
    }
  }
  return -1;
}

export function assertXlsxBuffer(buffer: Buffer, originalName: string): void {
  const name = originalName.trim().toLowerCase();
  if (!name.endsWith('.xlsx') || name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new Error('UNSUPPORTED_TYPE');
  }
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error('UNSUPPORTED_TYPE');
  }
  assertSafeXlsxZip(buffer);
}

export async function parseCustomerExcel(
  buffer: Buffer,
  maxRows = CUSTOMER_IMPORT_MAX_ROWS,
): Promise<ParsedCustomerExcel> {
  assertSafeXlsxZip(buffer);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new Error('MALFORMED');
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error('EMPTY');
  }
  if (workbook.worksheets.length > CUSTOMER_IMPORT_MAX_SHEETS) {
    throw new Error('SHEET_LIMIT');
  }

  const headerRow = sheet.getRow(1);
  let nameCol: number | undefined;
  let phoneCol: number | undefined;
  headerRow.eachCell((cell, colNumber) => {
    const key = headerKey(cellText(cell.value));
    if (NAME_HEADERS.has(key)) {
      nameCol = colNumber;
    }
    if (PHONE_HEADERS.has(key)) {
      phoneCol = colNumber;
    }
  });

  if (nameCol === undefined || phoneCol === undefined) {
    throw new Error('MISSING_HEADERS');
  }

  const rows: ParsedCustomerExcelRow[] = [];
  let dataRows = 0;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    const name = cellText(row.getCell(nameCol!).value);
    const phone = cellPhoneText(row.getCell(phoneCol!).value);
    if (!name && !phone) {
      return;
    }
    dataRows += 1;
    if (dataRows > maxRows) {
      throw new Error('ROW_LIMIT');
    }

    const errors: string[] = [];
    if (!name) {
      errors.push('Name is missing');
    }
    if (!phone) {
      errors.push('Phone is missing');
    }

    const split = name ? splitCustomerDisplayName(name) : null;
    if (name && !split) {
      errors.push('Name is invalid');
    }

    const phoneNumber = phone;
    if (phone && !isUsableCustomerPhone(phone)) {
      errors.push(CUSTOMER_PHONE_RULE_MESSAGE);
    }

    if (errors.length > 0 || !split) {
      rows.push({ row: rowNumber, status: 'INVALID', errors: errors.length ? errors : ['Invalid row'] });
      return;
    }

    rows.push({
      row: rowNumber,
      firstName: split.firstName,
      lastName: split.lastName,
      phoneNumber,
    });
  });

  if (rows.length === 0) {
    throw new Error('EMPTY');
  }

  return { rows };
}

export async function buildCustomerImportTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Salon Attention';
  const sheet = workbook.addWorksheet('Customers');
  sheet.addRow(['Name', 'Phone']);
  sheet.addRow(['Sara Ahmadi', '09121234567']);
  sheet.getRow(1).font = { bold: true };
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
