import ExcelJS from 'exceljs';
import { parseCustomerExcel, assertXlsxBuffer, buildCustomerImportTemplate } from './parse-customer-excel';

async function workbookBuffer(rows: Array<Array<string | number>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Customers');
  for (const row of rows) {
    sheet.addRow(row);
  }
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe('parseCustomerExcel', () => {
  it('parses Name and Phone with case-insensitive headers', async () => {
    const buffer = await workbookBuffer([
      [' name ', 'PHONE'],
      ['Sara Ahmadi', '09121234567'],
      ['Maryam Karimi', '+989129876543'],
    ]);
    const parsed = await parseCustomerExcel(buffer);
    expect(parsed.rows[0]).toEqual({
      row: 2,
      firstName: 'Sara',
      lastName: 'Ahmadi',
      phoneNumber: '09121234567',
    });
    expect(parsed.rows[1]).toMatchObject({
      row: 3,
      status: 'INVALID',
      errors: [expect.stringContaining('11 digits')],
    });
  });

  it('rejects alternative phone formats and numeric cells that lost a leading zero', async () => {
    const buffer = await workbookBuffer([
      ['Name', 'Phone'],
      ['Valid Canonical', '09121111111'],
      ['Missing Zero', '9121111111'],
      ['Plus98', '+989121111111'],
      ['ZeroZero98', '00989121111111'],
      ['Spaces', '0912 111 1111'],
      ['Hyphens', '0912-111-1111'],
      ['Short', '0912111111'],
      ['Long', '091211111111'],
      ['Numeric Lost Zero', 9121111111],
    ]);
    const parsed = await parseCustomerExcel(buffer);
    expect(parsed.rows[0]).toMatchObject({
      row: 2,
      firstName: 'Valid',
      lastName: 'Canonical',
      phoneNumber: '09121111111',
    });
    for (const row of parsed.rows.slice(1)) {
      expect(row).toMatchObject({ status: 'INVALID' });
      expect('errors' in row ? row.errors.join(' ') : '').toContain('11 digits');
    }
  });

  it('rejects leading or trailing phone whitespace without trimming', async () => {
    const buffer = await workbookBuffer([
      ['Name', 'Phone'],
      ['Valid Canonical', '09121111111'],
      ['Leading Space', ' 09121111111'],
      ['Trailing Space', '09121111111 '],
    ]);
    const parsed = await parseCustomerExcel(buffer);
    expect(parsed.rows[0]).toMatchObject({
      row: 2,
      phoneNumber: '09121111111',
    });
    expect(parsed.rows[1]).toMatchObject({
      row: 3,
      status: 'INVALID',
      errors: [expect.stringContaining('11 digits')],
    });
    expect(parsed.rows[2]).toMatchObject({
      row: 4,
      status: 'INVALID',
      errors: [expect.stringContaining('11 digits')],
    });
  });

  it('reports missing name, missing phone, and invalid phone', async () => {
    const buffer = await workbookBuffer([
      ['Name', 'Phone'],
      ['', '09121111111'],
      ['Neda Hosseini', ''],
      ['Leila Rezaei', '123'],
    ]);
    const parsed = await parseCustomerExcel(buffer);
    expect(parsed.rows[0]).toMatchObject({ row: 2, status: 'INVALID', errors: ['Name is missing'] });
    expect(parsed.rows[1]).toMatchObject({ row: 3, status: 'INVALID', errors: ['Phone is missing'] });
    expect(parsed.rows[2]).toMatchObject({
      row: 4,
      status: 'INVALID',
      errors: [expect.stringContaining('11 digits')],
    });
  });

  it('rejects missing headers, empty files, and oversized row counts', async () => {
    await expect(parseCustomerExcel(await workbookBuffer([['Foo', 'Bar']]))).rejects.toThrow('MISSING_HEADERS');
    await expect(parseCustomerExcel(await workbookBuffer([['Name', 'Phone']]))).rejects.toThrow('EMPTY');
    await expect(
      parseCustomerExcel(
        await workbookBuffer([
          ['Name', 'Phone'],
          ['A B', '09121111111'],
          ['C D', '09121111112'],
        ]),
        1,
      ),
    ).rejects.toThrow('ROW_LIMIT');
  });

  it('rejects non-xlsx buffers and path-like names', () => {
    expect(() => assertXlsxBuffer(Buffer.from('hello'), 'customers.xlsx')).toThrow('UNSUPPORTED_TYPE');
    expect(() => assertXlsxBuffer(Buffer.from([0x50, 0x4b, 0x03, 0x04]), '../customers.xlsx')).toThrow(
      'UNSUPPORTED_TYPE',
    );
    expect(() => assertXlsxBuffer(Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'customers.csv')).toThrow(
      'UNSUPPORTED_TYPE',
    );
  });

  it('rejects zip bombs advertised in the central directory before parsing cells', () => {
    const eocd = Buffer.alloc(22, 0);
    eocd[0] = 0x50;
    eocd[1] = 0x4b;
    eocd[2] = 0x05;
    eocd[3] = 0x06;
    eocd.writeUInt16LE(65, 10);
    expect(() => assertXlsxBuffer(eocd, 'customers.xlsx')).toThrow('ZIP_BOMB');
  });

  it('clips huge cells and treats them as invalid names', async () => {
    const huge = 'A'.repeat(400);
    const buffer = await workbookBuffer([
      ['Name', 'Phone'],
      [huge, '09121111111'],
    ]);
    const parsed = await parseCustomerExcel(buffer);
    expect(parsed.rows[0]).toMatchObject({ status: 'INVALID' });
  });

  it('uses the first worksheet and rejects workbooks with too many sheets', async () => {
    const workbook = new ExcelJS.Workbook();
    const first = workbook.addWorksheet('Customers');
    first.addRow(['Name', 'Phone']);
    first.addRow(['Sara Ahmadi', '09121234567']);
    workbook.addWorksheet('Extra');
    const twoSheets = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await parseCustomerExcel(twoSheets);
    expect(parsed.rows[0]).toMatchObject({ firstName: 'Sara', phoneNumber: '09121234567' });

    for (let i = 0; i < 8; i += 1) {
      workbook.addWorksheet(`Pad${i}`);
    }
    const tooMany = Buffer.from(await workbook.xlsx.writeBuffer());
    await expect(parseCustomerExcel(tooMany)).rejects.toThrow('SHEET_LIMIT');
  });

  it('builds a template with Name and Phone headers', async () => {
    const template = await buildCustomerImportTemplate();
    const parsed = await parseCustomerExcel(template);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ firstName: 'Sara', phoneNumber: '09121234567' });
  });
});
