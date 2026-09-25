import ExcelJS from 'exceljs';
import { parseVipTargetExcel } from './parse-vip-excel';
import { assertXlsxBuffer } from '../customer/parse-customer-excel';

async function workbookBuffer(rows: Array<Array<string | number>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('VIP');
  for (const row of rows) {
    sheet.addRow(row);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('parseVipTargetExcel', () => {
  it('parses Persian headers and keeps the first duplicate phone', async () => {
    const buffer = await workbookBuffer([
      ['نام', 'شماره تلفن'],
      ['مریم احمدی', '09121111111'],
      ['سارا', '09121111111'],
      ['نیلوفر', '09121111112'],
    ]);
    const rows = await parseVipTargetExcel(buffer);
    expect(rows).toEqual([
      { row: 2, displayName: 'مریم احمدی', phoneNumber: '09121111111' },
      { row: 4, displayName: 'نیلوفر', phoneNumber: '09121111112' },
    ]);
  });

  it('rejects more than 100 data rows without truncating', async () => {
    const rows: Array<Array<string>> = [['نام', 'شماره تلفن']];
    for (let i = 0; i < 101; i += 1) {
      rows.push(['نام', `0912${String(i).padStart(7, '0')}`]);
    }
    await expect(parseVipTargetExcel(await workbookBuffer(rows))).rejects.toThrow('ROW_LIMIT');
  });

  it('rejects invalid phones instead of inventing numbers', async () => {
    await expect(
      parseVipTargetExcel(
        await workbookBuffer([
          ['نام', 'شماره تلفن'],
          ['مریم', '+989121111111'],
        ]),
      ),
    ).rejects.toThrow('INVALID_PHONE');
  });

  it('rejects path-like names', () => {
    expect(() => assertXlsxBuffer(Buffer.from([0x50, 0x4b, 0x03, 0x04]), '../vip.xlsx')).toThrow(
      'UNSUPPORTED_TYPE',
    );
  });

  it('rejects a fake .xlsx extension that is not a ZIP', () => {
    expect(() => assertXlsxBuffer(Buffer.from('not-a-zip'), 'vip.xlsx')).toThrow('UNSUPPORTED_TYPE');
  });

  it('parses 100 valid rows and skips blank rows', async () => {
    const rows: Array<Array<string>> = [['نام', 'شماره تلفن'], ['', '']];
    for (let i = 0; i < 100; i += 1) {
      rows.push([`نام ${i + 1}`, `0918${String(i).padStart(7, '0')}`]);
    }
    const parsed = await parseVipTargetExcel(await workbookBuffer(rows));
    expect(parsed).toHaveLength(100);
  });

  it('does not evaluate a formula in the name cell and stores a null name', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('VIP');
    sheet.addRow(['نام', 'شماره تلفن']);
    const row = sheet.addRow(['', '09121111111']);
    row.getCell(1).value = { formula: 'HYPERLINK("http://evil")' };
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await expect(parseVipTargetExcel(buffer)).resolves.toEqual([
      { row: 2, displayName: null, phoneNumber: '09121111111' },
    ]);
  });

  it('parses a phone-only workbook with null displayName', async () => {
    const rows = await parseVipTargetExcel(
      await workbookBuffer([
        ['شماره تلفن'],
        ['09121111111'],
        ['09121111112'],
      ]),
    );
    expect(rows).toEqual([
      { row: 2, displayName: null, phoneNumber: '09121111111' },
      { row: 3, displayName: null, phoneNumber: '09121111112' },
    ]);
  });

  it('treats an empty name cell as null when the name column is present', async () => {
    const rows = await parseVipTargetExcel(
      await workbookBuffer([
        ['نام', 'شماره تلفن'],
        ['', '09121111111'],
        ['مریم', '09121111112'],
      ]),
    );
    expect(rows).toEqual([
      { row: 2, displayName: null, phoneNumber: '09121111111' },
      { row: 3, displayName: 'مریم', phoneNumber: '09121111112' },
    ]);
  });

  it('rejects a missing phone column', async () => {
    await expect(parseVipTargetExcel(await workbookBuffer([['نام'], ['مریم']]))).rejects.toThrow(
      'MISSING_HEADERS',
    );
  });

  it('rejects a numeric Excel phone that lost the leading zero', async () => {
    await expect(
      parseVipTargetExcel(await workbookBuffer([['شماره تلفن'], [9121111111]])),
    ).rejects.toThrow('INVALID_PHONE');
  });

  it('does not trim phone whitespace into validity', async () => {
    await expect(
      parseVipTargetExcel(await workbookBuffer([['شماره تلفن'], [' 09121111111']])),
    ).rejects.toThrow('INVALID_PHONE');
  });
});
