import {
  PERSISTENT_CATALOG_CONFIRMATION,
  assertDisposableCatalogTarget,
  assertPersistentCatalogTarget,
  parseVipCatalogManifest,
  VipCatalogClassificationError,
} from './vip-catalog-membership';

const HEADER = 'id,name,region_code,status,recorded_contacts,contact_rows,reserved_by_salon_id,vip_requests,created_at';
const ID_A = '00000000-0000-4000-8000-0000000000a1';
const ID_B = '00000000-0000-4000-8000-0000000000b2';

function line(id: string, overrides: Partial<Record<string, string>> = {}): string {
  const values = {
    id,
    name: 'List',
    region_code: '01',
    status: 'ACTIVE',
    recorded_contacts: '1',
    contact_rows: '1',
    reserved_by_salon_id: '',
    vip_requests: '0',
    created_at: '2026-01-01',
    ...overrides,
  };
  return [values.id, values.name, values.region_code, values.status, values.recorded_contacts, values.contact_rows, values.reserved_by_salon_id, values.vip_requests, values.created_at].join(',');
}

describe('VIP catalog manifest', () => {
  it('parses membership rows without treating names as identity', () => {
    const rows = parseVipCatalogManifest(
      `${HEADER}\n${ID_A},"نام، با ویرگول",01,ACTIVE,1,1,,0,2026-01-01`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: ID_A,
      regionCode: '01',
      status: 'ACTIVE',
      recordedContacts: 1,
      contactRows: 1,
      reservedBySalonId: null,
      vipRequests: 0,
    });
  });

  it('rejects duplicate ids before any database work', () => {
    expect(() => parseVipCatalogManifest(`${HEADER}\n${line(ID_A)}\n${line(ID_A)}`)).toThrow(VipCatalogClassificationError);
    try {
      parseVipCatalogManifest(`${HEADER}\n${line(ID_A)}\n${line(ID_B)}`);
    } catch {
      throw new Error('distinct ids should parse');
    }
    try {
      parseVipCatalogManifest(`${HEADER}\n${line(ID_A)}\n${line(ID_A)}`);
    } catch (error) {
      expect(error).toBeInstanceOf(VipCatalogClassificationError);
      expect((error as VipCatalogClassificationError).code).toBe('MANIFEST_DUPLICATE_ID');
    }
  });
});

describe('disposable catalog target', () => {
  const preview = 'postgresql://preview:secret@127.0.0.1:15442/salon_preview';

  it('accepts the loopback preview database', () => {
    expect(() => assertDisposableCatalogTarget(preview, 'salon_preview')).not.toThrow();
  });

  it('refuses the persistent salon database and port 5432', () => {
    expect(() => assertDisposableCatalogTarget('postgresql://preview:secret@127.0.0.1:5432/salon', 'salon')).toThrow(/persistent/i);
    expect(() => assertDisposableCatalogTarget('postgresql://preview:secret@127.0.0.1:15442/salon', 'salon_preview')).toThrow(/persistent/i);
    expect(() => assertDisposableCatalogTarget(preview, 'salon')).toThrow(/persistent/i);
  });

  it('refuses a mismatched database name without echoing the URL', () => {
    try {
      assertDisposableCatalogTarget(preview, 'salon_inventory_checks');
      throw new Error('expected mismatch');
    } catch (error) {
      expect(error).toBeInstanceOf(VipCatalogClassificationError);
      expect((error as Error).message).not.toContain('secret');
      expect((error as Error).message).not.toContain('postgresql://');
    }
  });
});

describe('persistent catalog target', () => {
  const persistent = 'postgresql://salon:secret@127.0.0.1:5432/salon';
  const systemIdentifier = '100';
  const allowed = {
    expectedDatabase: 'salon',
    systemIdentifier,
    confirmation: PERSISTENT_CATALOG_CONFIRMATION,
    hostPort: '5432',
  };

  it('accepts the loopback persistent database on port 5432', () => {
    expect(() => assertPersistentCatalogTarget(persistent, allowed)).not.toThrow();
  });

  it('accepts an explicit rehearsal port that is not the preview port', () => {
    expect(() => assertPersistentCatalogTarget('postgresql://salon:secret@127.0.0.1:15443/salon', {
      ...allowed,
      hostPort: '15443',
    })).not.toThrow();
  });

  it('refuses the preview port, a non-salon database, and a missing confirmation', () => {
    expect(() => assertPersistentCatalogTarget('postgresql://salon:secret@127.0.0.1:15442/salon', {
      ...allowed,
      hostPort: '15442',
    })).toThrow(VipCatalogClassificationError);
    expect(() => assertPersistentCatalogTarget('postgresql://salon:secret@127.0.0.1:5432/salon_preview', allowed)).toThrow(/salon/);
    expect(() => assertPersistentCatalogTarget(persistent, { ...allowed, confirmation: 'yes' })).toThrow(/confirmation/i);
    expect(() => assertPersistentCatalogTarget(persistent, { ...allowed, expectedDatabase: 'salon_preview' })).toThrow(VipCatalogClassificationError);
    expect(() => assertPersistentCatalogTarget(persistent, { ...allowed, systemIdentifier: 'not-numeric' })).toThrow(VipCatalogClassificationError);
    expect(() => assertPersistentCatalogTarget('postgresql://salon:secret@203.0.113.5:5432/salon', allowed)).toThrow(/loopback/i);
  });

  it('does not echo the URL when the persistent target is refused', () => {
    try {
      assertPersistentCatalogTarget(previewUrl(), { ...allowed, hostPort: '15443' });
      throw new Error('expected refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(VipCatalogClassificationError);
      expect((error as Error).message).not.toContain('secret');
      expect((error as Error).message).not.toContain('postgresql://');
    }
  });
});

function previewUrl(): string {
  return 'postgresql://salon:secret@127.0.0.1:15443/salon_preview';
}
