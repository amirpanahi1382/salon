import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { VISIT_EXPORT_HEADERS, VISIT_EXPORT_SHEET_NAME } from './visit-export.constants';
import { buildVisitsWorkbook } from './visit-export.xlsx';

describe('buildVisitsWorkbook', () => {
  it('writes Persian RTL headers and typed cells', async () => {
    const buffer = await buildVisitsWorkbook([
      {
        customerName: 'مریم احمدی',
        serviceName: 'Hair Service',
        amountReceived: '8000000.00',
        visitedAt: new Date('2026-08-31T10:00:00.000Z'),
        daysSincePreviousVisit: 30,
      },
      {
        customerName: 'مریم احمدی',
        serviceName: null,
        amountReceived: null,
        visitedAt: new Date('2026-08-01T10:00:00.000Z'),
        daysSincePreviousVisit: null,
      },
    ]);

    const dir = await mkdtemp(join(tmpdir(), 'visits-xlsx-'));
    const file = join(dir, 'visits.xlsx');
    await writeFile(file, buffer);
    execFileSync('tar', ['-xf', file, '-C', dir]);
    const sheetXml = await readFile(join(dir, 'xl/worksheets/sheet1.xml'), 'utf8');
    const stylesXml = await readFile(join(dir, 'xl/styles.xml'), 'utf8');
    const shared = await readFile(join(dir, 'xl/sharedStrings.xml'), 'utf8');
    expect(sheetXml).toContain('rightToLeft="1"');
    expect(`${stylesXml}${sheetXml}`).toMatch(/readingOrder="2"/);
    expect(shared).toContain('نام مشتری');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet(VISIT_EXPORT_SHEET_NAME);
    expect(sheet).toBeDefined();
    expect(sheet!.views?.[0]?.rightToLeft).toBe(true);
    expect(sheet!.views?.[0]?.state).toBe('frozen');
    expect(sheet!.autoFilter).toBeTruthy();

    const header = sheet!.getRow(1);
    expect(VISIT_EXPORT_HEADERS.map((_, index) => String(header.getCell(index + 1).value))).toEqual([
      ...VISIT_EXPORT_HEADERS,
    ]);
    expect(header.font?.bold).toBe(true);
    expect(header.font?.name).toBe('Tahoma');
    expect(header.getCell(1).alignment?.horizontal).toBe('right');

    const sale = sheet!.getRow(2);
    expect(sale.getCell(1).value).toBe('مریم احمدی');
    expect(sale.getCell(2).value).toBe('Hair Service');
    expect(sale.getCell(3).value).toBe(8000000);
    expect(sale.getCell(3).numFmt).toBe('#,##0.00');
    expect(sale.getCell(4).value).toBe('۱۴۰۵/۰۶/۰۹ ۱۳:۳۰');
    expect(sale.getCell(5).value).toBe(30);

    const firstVisit = sheet!.getRow(3);
    expect(firstVisit.getCell(2).value).toBeNull();
    expect(firstVisit.getCell(3).value).toBeNull();
    expect(firstVisit.getCell(4).value).toBe('۱۴۰۵/۰۵/۱۰ ۱۳:۳۰');
    expect(firstVisit.getCell(5).value).toBeNull();
  });
});
