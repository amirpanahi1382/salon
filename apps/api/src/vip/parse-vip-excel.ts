import ExcelJS from 'exceljs';
import {
  isUsableCustomerPhone,
  sanitizeCustomerNamePart,
  VIP_DISPLAY_NAME_MAX_LENGTH,
  VIP_LIST_MAX_CONTACTS,
} from '@salon/shared';
import {
  CUSTOMER_IMPORT_MAX_CELL_CHARS,
  CUSTOMER_IMPORT_MAX_SHEETS,
} from '../customer/customer-import.constants';
import { assertSafeXlsxZip } from '../customer/parse-customer-excel';

export type ParsedVipExcelRow = {
  row: number;
  displayName: string | null;
  phoneNumber: string;
};

const NAME_HEADERS = new Set(['نام', 'name']);
const PHONE_HEADERS = new Set(['شماره تلفن', 'شمارهتلفن', 'phone', 'phone number']);

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
    const clipped =
      text.length > CUSTOMER_IMPORT_MAX_CELL_CHARS
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
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function sanitizeVipDisplayName(raw: string): string | null {
  const collapsed = raw.trim().replace(/\s+/g, ' ');
  if (!collapsed || collapsed.length > VIP_DISPLAY_NAME_MAX_LENGTH) {
    return null;
  }
  const parts = collapsed.split(' ');
  const first = sanitizeCustomerNamePart(parts[0] ?? '');
  if (!first) {
    return null;
  }
  if (parts.length === 1) {
    return first;
  }
  const rest = sanitizeCustomerNamePart(parts.slice(1).join(' '));
  if (rest === null) {
    return null;
  }
  return rest ? `${first} ${rest}` : first;
}

export async function parseVipTargetExcel(buffer: Buffer): Promise<ParsedVipExcelRow[]> {
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
  if (phoneCol === undefined) {
    throw new Error('MISSING_HEADERS');
  }

  const accepted: ParsedVipExcelRow[] = [];
  const seenPhones = new Set<string>();
  let dataRows = 0;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    const name = nameCol === undefined ? '' : cellText(row.getCell(nameCol).value);
    const phone = cellPhoneText(row.getCell(phoneCol!).value);
    if (!name && !phone) {
      return;
    }
    dataRows += 1;
    if (dataRows > VIP_LIST_MAX_CONTACTS) {
      throw new Error('ROW_LIMIT');
    }
    let displayName: string | null = null;
    if (name) {
      displayName = sanitizeVipDisplayName(name);
      if (!displayName) {
        throw new Error('INVALID_ROW');
      }
    }
    if (!phone || !isUsableCustomerPhone(phone)) {
      throw new Error(phone && !isUsableCustomerPhone(phone) ? 'INVALID_PHONE' : 'INVALID_ROW');
    }
    if (seenPhones.has(phone)) {
      return;
    }
    seenPhones.add(phone);
    accepted.push({ row: rowNumber, displayName, phoneNumber: phone });
  });

  if (accepted.length === 0) {
    throw new Error('EMPTY');
  }
  if (accepted.length > VIP_LIST_MAX_CONTACTS) {
    throw new Error('ROW_LIMIT');
  }
  return accepted;
}

export async function buildVipImportTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Salon Attention';
  const sheet = workbook.addWorksheet('VIP');
  sheet.addRow(['نام', 'شماره تلفن']);
  sheet.addRow(['مریم احمدی', '09121234567']);
  sheet.addRow(['', '09121234568']);
  sheet.getRow(1).font = { bold: true };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
