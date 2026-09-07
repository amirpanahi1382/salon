import { createRequire } from 'node:module';
import ExcelJS from 'exceljs';
import { formatMoneyString, parseMoneyString } from '@salon/shared';
import { formatJalaliDateTimeTehran } from './jalali-format';
import {
  VISIT_EXPORT_HEADERS,
  VISIT_EXPORT_SHEET_NAME,
} from './visit-export.constants';
import type { VisitExportSqlRow } from './visit.repository';

const PERSIAN_FONT = 'Tahoma';
const HEADER_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE8E0D8' },
};

export type VisitExportRow = {
  customerName: string;
  serviceName: string | null;
  amountReceived: string | null;
  visitedAt: Date;
  daysSincePreviousVisit: number | null;
};

export function toVisitExportRow(row: VisitExportSqlRow): VisitExportRow {
  const days =
    row.daysSincePreviousVisit === null || row.daysSincePreviousVisit === undefined
      ? null
      : Number(row.daysSincePreviousVisit);
  return {
    customerName: `${row.firstName} ${row.lastName}`.trim(),
    serviceName: row.serviceName,
    amountReceived: row.amountReceived,
    visitedAt: row.visitedAt,
    daysSincePreviousVisit: Number.isFinite(days) ? days : null,
  };
}

export async function buildVisitsWorkbook(rows: VisitExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Salon Attention';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(VISIT_EXPORT_SHEET_NAME);
  sheet.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];
  sheet.properties.defaultColWidth = 22;

  const header = sheet.addRow([...VISIT_EXPORT_HEADERS]);
  applyPersianCellStyle(header, true);

  for (const row of rows) {
    const excelRow = sheet.addRow([
      row.customerName,
      row.serviceName,
      amountCellValue(row.amountReceived),
      formatJalaliDateTimeTehran(row.visitedAt),
      row.daysSincePreviousVisit,
    ]);
    applyPersianCellStyle(excelRow, false);
    excelRow.getCell(3).numFmt = '#,##0.00';
    excelRow.getCell(5).numFmt = '0';
  }

  sheet.columns = [
    { width: 28 },
    { width: 28 },
    { width: 18 },
    { width: 24 },
    { width: 32 },
  ];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: VISIT_EXPORT_HEADERS.length },
  };

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return injectReadingOrder(Buffer.from(arrayBuffer));
}

function applyPersianCellStyle(row: ExcelJS.Row, header: boolean) {
  row.font = { name: PERSIAN_FONT, bold: header, size: header ? 12 : 11 };
  if (header) {
    row.height = 22;
    row.fill = HEADER_FILL;
  }
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { name: PERSIAN_FONT, bold: header, size: header ? 12 : 11 };
    cell.alignment = { horizontal: 'right', vertical: 'middle', readingOrder: 'rtl' };
    if (header) {
      cell.fill = HEADER_FILL;
    }
  });
}

function amountCellValue(amount: string | null): number | null {
  if (!amount) {
    return null;
  }
  try {
    const formatted = formatMoneyString(parseMoneyString(amount));
    const numeric = Number(formatted);
    return Number.isFinite(numeric) ? numeric : null;
  } catch {
    return null;
  }
}

const nodeRequire = createRequire(__filename);

async function injectReadingOrder(buffer: Buffer): Promise<Buffer> {
  // ExcelJS 4.x keeps worksheet RTL but does not serialize cell readingOrder.
  const JSZip = nodeRequire(nodeRequire.resolve('jszip', { paths: [nodeRequire.resolve('exceljs')] }));
  const zip = await JSZip.loadAsync(buffer);
  const stylesFile = zip.file('xl/styles.xml');
  if (!stylesFile) {
    return buffer;
  }
  const xml = (await stylesFile.async('string')) as string;
  zip.file(
    'xl/styles.xml',
    xml.replace(
      /<alignment horizontal="right" vertical="center"\/>/g,
      '<alignment horizontal="right" vertical="center" readingOrder="2"/>',
    ),
  );
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}
