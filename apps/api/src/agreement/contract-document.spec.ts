import type { Request } from 'express';
import { AgreementPhoneUnverifiedError, ValidationError } from '@salon/shared';
import { CONTRACT_V1_TEXT } from './CONTRACT_V1';
import {
  CONTRACT_V1_DIGEST,
  agreementHtmlDocument,
  assertContractV1Intact,
  renderContract,
  segmentContract,
  sha256Utf8,
} from './contract-document';
import { normalizeDeclaredFields, normalizeIranianNationalId } from './declared-fields';
import { decryptEvidence, encryptEvidence, type EvidenceKeyRing } from './evidence-cipher';
import { readTechnicalContext, verifiedForwardedClientIp } from './technical-context';

const verifiedPhone = '09120000000';

describe('CONTRACT_V1', () => {
  it('locks the source bytes, amount, obligation, and confirmation wording', () => {
    const contract = assertContractV1Intact();
    expect(sha256Utf8(CONTRACT_V1_TEXT)).toBe(CONTRACT_V1_DIGEST);
    expect(contract.versionKey).toBe('CONTRACT_V1');
    expect(contract.buttonWording).toBe('تأیید قرارداد و ادامه به راهنمای واریز');
    expect(contract.scope.amountIrr).toBe('50000000.00');
    expect(contract.canonicalText.includes('حق استرداد وجه ایجاد نمی‌کند')).toBe(true);
    expect(contract.canonicalText.includes('صاحب و مالک برنامهٔ «جذب مشتری»')).toBe(true);
    expect(contract.canonicalText.startsWith('☐')).toBe(false);
    const checkbox = contract.canonicalText.split('\n').find((line) => line.startsWith('☐ '));
    expect(checkbox?.startsWith('☑')).toBe(false);
  });

  it('renders only the four fill-in fields and keeps every other byte', () => {
    const contract = assertContractV1Intact();
    const fields = {
      fullName: 'نرگس رضایی',
      nationalId: nationalId('001234567'),
      salonName: 'سالن نرگس',
      phone: verifiedPhone,
    };
    const rendered = renderContract(contract.canonicalText, fields);
    expect(rendered).toContain(fields.fullName);
    expect(rendered).toContain(fields.nationalId);
    expect(rendered).toContain(fields.salonName);
    expect(rendered).toContain(fields.phone);
    expect(rendered).not.toContain('[توسط سفارش‌دهنده تکمیل می‌شود]');
    const rejoined = segmentContract(contract.canonicalText)
      .map((segment) => (segment.type === 'text' ? segment.text : `[${segment.field}]`))
      .join('');
    expect(rejoined.replaceAll('[fullName]', '[توسط سفارش‌دهنده تکمیل می‌شود]')
      .replaceAll('[nationalId]', '[توسط سفارش‌دهنده تکمیل می‌شود]')
      .replaceAll('[salonName]', '[توسط سفارش‌دهنده تکمیل می‌شود]')
      .replace('[phone]', '[توسط سفارش‌دهنده تکمیل و با رمز یک‌بارمصرف تأیید می‌شود]')).toBe(
      contract.canonicalText,
    );
    expect(sha256Utf8(renderContract(contract.canonicalText, fields))).toBe(sha256Utf8(rendered));
    const changed = renderContract(contract.canonicalText, { ...fields, salonName: 'سالن دیگر' });
    expect(sha256Utf8(changed)).not.toBe(sha256Utf8(rendered));
  });

  it('escapes user text in HTML without changing the canonical bytes', () => {
    const canonical = 'نام <script> & "نرگس"';
    const html = agreementHtmlDocument(canonical);
    expect(html).toContain('نام &lt;script&gt; &amp; &quot;نرگس&quot;');
    expect(html).not.toContain('<script>');
    expect(sha256Utf8(canonical)).toBe(sha256Utf8('نام <script> & "نرگس"'));
  });
});

describe('declared agreement fields', () => {
  it('normalizes a declared national ID and blocks an unverified phone', () => {
    const id = nationalId('001354241');
    expect(normalizeIranianNationalId(` ${id.replace('1', '۱')} `)).toBe(id);
    expect(normalizeIranianNationalId('0000000000')).toBeNull();
    expect(normalizeIranianNationalId(`${id.slice(0, 9)}0`)).toBeNull();
    const fields = normalizeDeclaredFields(
      {
        fullName: '  نرگس   رضایی ',
        nationalId: id,
        salonName: 'سالن نرگس',
        phone: '0912 000 0000',
      },
      verifiedPhone,
    );
    expect(fields.fullName).toBe('نرگس رضایی');
    expect(fields.phone).toBe(verifiedPhone);
    expect(() =>
      normalizeDeclaredFields(
        { fullName: 'نرگس رضایی', nationalId: id, salonName: 'سالن', phone: '09121111111' },
        verifiedPhone,
      ),
    ).toThrow(AgreementPhoneUnverifiedError);
    expect(() =>
      normalizeDeclaredFields(
        { fullName: ' ', nationalId: id, salonName: 'سالن', phone: verifiedPhone },
        verifiedPhone,
      ),
    ).toThrow(ValidationError);
  });

  it('accepts Persian full names with half-spaces and rejects Latin, Urdu, digits, and separators', () => {
    const id = nationalId('001354241');
    const withHalfSpace = normalizeDeclaredFields(
      {
        fullName: 'سید\u200cعلی رضایی',
        nationalId: id,
        salonName: 'سالن',
        phone: verifiedPhone,
      },
      verifiedPhone,
    );
    expect(withHalfSpace.fullName).toContain('\u200c');
    expect(
      normalizeDeclaredFields(
        {
          fullName: 'علي رضا', // Arabic Yeh → Persian Yeh
          nationalId: id,
          salonName: 'سالن',
          phone: verifiedPhone,
        },
        verifiedPhone,
      ).fullName,
    ).toBe('علی رضا');
    expect(
      normalizeDeclaredFields(
        { fullName: 'فاطمه زهرا', nationalId: id, salonName: 'سالن', phone: verifiedPhone },
        verifiedPhone,
      ).fullName,
    ).toBe('فاطمه زهرا');
    expect(() =>
      normalizeDeclaredFields(
        { fullName: 'Narges Rezaei', nationalId: id, salonName: 'سالن', phone: verifiedPhone },
        verifiedPhone,
      ),
    ).toThrow(/Persian full name/);
    expect(() =>
      normalizeDeclaredFields(
        { fullName: 'نرگس 2', nationalId: id, salonName: 'سالن', phone: verifiedPhone },
        verifiedPhone,
      ),
    ).toThrow(/Persian full name/);
    // Urdu-specific letters must not pass via Script=Arabic.
    expect(() =>
      normalizeDeclaredFields(
        { fullName: 'محمدے', nationalId: id, salonName: 'سالن', phone: verifiedPhone },
        verifiedPhone,
      ),
    ).toThrow(/Persian full name/);
    expect(() =>
      normalizeDeclaredFields(
        { fullName: 'احمدٹ', nationalId: id, salonName: 'سالن', phone: verifiedPhone },
        verifiedPhone,
      ),
    ).toThrow(/Persian full name/);
    expect(() =>
      normalizeDeclaredFields(
        { fullName: '\u200c\u200c', nationalId: id, salonName: 'سالن', phone: verifiedPhone },
        verifiedPhone,
      ),
    ).toThrow(/Persian full name/);
    expect(() =>
      normalizeDeclaredFields(
        { fullName: 'نرگس\u200c', nationalId: id, salonName: 'سالن', phone: verifiedPhone },
        verifiedPhone,
      ),
    ).toThrow(/Persian full name/);
  });

  it('keeps the national ID checksum and accepts mixed Persian/English salon names', () => {
    const id = nationalId('001354241');
    expect(() =>
      normalizeDeclaredFields(
        { fullName: 'نرگس رضایی', nationalId: `${id.slice(0, 9)}0`, salonName: 'سالن', phone: verifiedPhone },
        verifiedPhone,
      ),
    ).toThrow(/checksum/i);
    expect(() =>
      normalizeDeclaredFields(
        { fullName: 'نرگس رضایی', nationalId: '12345', salonName: 'سالن', phone: verifiedPhone },
        verifiedPhone,
      ),
    ).toThrow(/10 digits/i);
    const mixed = normalizeDeclaredFields(
      {
        fullName: 'نرگس رضایی',
        nationalId: id,
        salonName: 'سالن Glow Beauty',
        phone: verifiedPhone,
      },
      verifiedPhone,
    );
    expect(mixed.salonName).toBe('سالن Glow Beauty');
  });
});

describe('agreement evidence cipher', () => {
  const ring: EvidenceKeyRing = {
    currentId: 'env-1',
    keys: new Map([['env-1', Buffer.alloc(32, 3)]]),
  };

  it('round-trips a snapshot and rejects a swapped record', () => {
    const plaintext = Buffer.from('کد ملی محرمانه', 'utf8');
    const encrypted = encryptEvidence(ring, 'agreement-acceptance-snapshot:one', plaintext);
    expect(encrypted.ciphertext.includes(plaintext)).toBe(false);
    expect(
      decryptEvidence(ring, encrypted.keyId, encrypted.nonce, encrypted.ciphertext, 'agreement-acceptance-snapshot:one')
        .equals(plaintext),
    ).toBe(true);
    expect(() =>
      decryptEvidence(ring, encrypted.keyId, encrypted.nonce, encrypted.ciphertext, 'agreement-acceptance-snapshot:two'),
    ).toThrow(/cannot be decrypted/);
  });
});

describe('trusted client IP', () => {
  const proxies = ['10.0.0.1', '10.0.0.2'];

  function request(input: { socket: string; forwarded?: unknown }): Request {
    return {
      headers: input.forwarded === undefined ? {} : { 'x-forwarded-for': input.forwarded },
      socket: { remoteAddress: input.socket },
    } as Request;
  }

  it('records the socket and ignores a forged header in the default configuration', () => {
    const req = request({ socket: '198.51.100.20', forwarded: '203.0.113.9, 198.51.100.4' });
    const context = readTechnicalContext(req, { trustedProxyHops: 0, trustedProxyIps: [] }, 'rev');
    expect(context.observedSocketIp).toBe('198.51.100.20');
    expect(context.clientIp).toBe('198.51.100.20');
    expect(context.clientIpSource).toBe('socket');
    expect(verifiedForwardedClientIp(req, { trustedProxyHops: 0, trustedProxyIps: proxies }, '10.0.0.2')).toBeNull();
  });

  it('ignores a forged header when the socket is not a configured proxy', () => {
    const req = request({ socket: '203.0.113.50', forwarded: '198.51.100.4, 203.0.113.9' });
    const context = readTechnicalContext(
      req,
      { trustedProxyHops: 1, trustedProxyIps: ['10.0.0.2'] },
      'rev',
    );
    expect(context.clientIpSource).toBe('socket');
    expect(context.clientIp).toBe('203.0.113.50');
    expect(context.observedSocketIp).toBe('203.0.113.50');
  });

  it('uses the address appended by one trusted proxy and ignores the client-supplied prefix', () => {
    const req = request({
      socket: '::ffff:10.0.0.2',
      forwarded: '203.0.113.9, 198.51.100.4',
    });
    const context = readTechnicalContext(req, { trustedProxyHops: 1, trustedProxyIps: ['10.0.0.2'] }, 'rev');
    expect(context.observedSocketIp).toBe('::ffff:10.0.0.2');
    expect(context.clientIp).toBe('198.51.100.4');
    expect(context.clientIpSource).toBe('trusted_proxy');
    expect(context.clientIp).not.toBe('203.0.113.9');
  });

  it('walks multiple trusted hops and keeps the client to the left of that chain', () => {
    const req = request({
      socket: '10.0.0.2',
      forwarded: ['203.0.113.9', '198.51.100.4, 10.0.0.1'],
    });
    const context = readTechnicalContext(req, { trustedProxyHops: 2, trustedProxyIps: proxies }, 'rev');
    expect(context.observedSocketIp).toBe('10.0.0.2');
    expect(context.clientIp).toBe('198.51.100.4');
    expect(context.clientIpSource).toBe('trusted_proxy');
  });

  it('fails closed for a malformed address, a short chain, and a proxy used as the client', () => {
    const trust = { trustedProxyHops: 1, trustedProxyIps: ['10.0.0.2'] };
    expect(
      verifiedForwardedClientIp(request({ socket: '10.0.0.2', forwarded: 'not-an-ip' }), trust, '10.0.0.2'),
    ).toBeNull();
    expect(
      verifiedForwardedClientIp(request({ socket: '10.0.0.2', forwarded: '198.51.100.4:80' }), trust, '10.0.0.2'),
    ).toBeNull();
    expect(
      verifiedForwardedClientIp(request({ socket: '10.0.0.2', forwarded: '10.0.0.2' }), trust, '10.0.0.2'),
    ).toBeNull();
    expect(
      verifiedForwardedClientIp(
        request({ socket: '10.0.0.2', forwarded: '198.51.100.4' }),
        { trustedProxyHops: 2, trustedProxyIps: proxies },
        '10.0.0.2',
      ),
    ).toBeNull();
    const malformed = readTechnicalContext(
      request({ socket: '10.0.0.2', forwarded: '203.0.113.9, 999.1.1.1' }),
      trust,
      'rev',
    );
    expect(malformed.clientIp).toBe('10.0.0.2');
    expect(malformed.clientIpSource).toBe('socket');
  });
});

function nationalId(base9: string): string {
  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    sum += Number(base9[index]) * (10 - index);
  }
  const remainder = sum % 11;
  const check = remainder < 2 ? remainder : 11 - remainder;
  return `${base9}${check}`;
}
