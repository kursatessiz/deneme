import {
  AttributionReportQuerySchema,
  CONTACT_FIELD_KINDS,
  ContactListQuerySchema,
  CreateContactFieldSchema,
  CreateContactSchema,
  MergeContactsSchema,
  normalizeTag,
  splitContactName,
  validateCustomFieldValue,
} from './crm';
import { SEGMENT_FIELD_KINDS } from './growth/segments';
import { BASE_MESSAGES } from './i18n/messages';
import { DEFAULT_PIPELINE_STAGES } from './crm';
import { LIFECYCLE_STAGES } from './growth/conversions';

describe('crm contracts', () => {
  it('custom field kinds are a subset of the segment field kinds', () => {
    for (const kind of CONTACT_FIELD_KINDS) expect(SEGMENT_FIELD_KINDS).toContain(kind);
  });

  it('every built-in stage, lifecycle stage and field kind has a translated label', () => {
    const keys = Object.keys(BASE_MESSAGES);
    for (const s of DEFAULT_PIPELINE_STAGES) expect(keys).toContain(`crm.stage.${s.key}`);
    for (const s of LIFECYCLE_STAGES) expect(keys).toContain(`crm.lifecycle.${s}`);
    for (const k of CONTACT_FIELD_KINDS) expect(keys).toContain(`crm.fieldKind.${k}`);
  });

  it('normalises tags', () => {
    expect(normalizeTag('  VIP  Üye ')).toBe('vip üye');
    expect(normalizeTag('-leading')).toBeNull();
    expect(normalizeTag('')).toBeNull();
    expect(normalizeTag('x'.repeat(41))).toBeNull();
  });

  it('splits a full name on the last word', () => {
    expect(splitContactName('Ayse Nur Yilmaz')).toEqual({ firstName: 'Ayse Nur', lastName: 'Yilmaz' });
    expect(splitContactName('Cher')).toEqual({ firstName: 'Cher', lastName: '' });
  });

  it('validates custom field values by kind', () => {
    expect(validateCustomFieldValue({ kind: 'number', options: [] }, 3)).toBeNull();
    expect(validateCustomFieldValue({ kind: 'number', options: [] }, '3')).not.toBeNull();
    expect(validateCustomFieldValue({ kind: 'date', options: [] }, '2026-09-28')).toBeNull();
    expect(validateCustomFieldValue({ kind: 'date', options: [] }, '28.09.2026')).not.toBeNull();
    expect(validateCustomFieldValue({ kind: 'enum', options: ['a', 'b'] }, 'b')).toBeNull();
    expect(validateCustomFieldValue({ kind: 'enum', options: ['a', 'b'] }, 'c')).not.toBeNull();
    expect(validateCustomFieldValue({ kind: 'boolean', options: [] }, null)).toBeNull();
  });

  it('a contact needs a phone or an email', () => {
    expect(CreateContactSchema.safeParse({ firstName: 'A' }).success).toBe(false);
    expect(CreateContactSchema.safeParse({ firstName: 'A', email: 'a@example.com' }).success).toBe(true);
    const parsed = CreateContactSchema.parse({ firstName: 'A', phone: '0532 111 22 33', tags: ['VIP'] });
    expect(parsed.phone).toBe('+905321112233');
    expect(parsed.tags).toEqual(['vip']);
  });

  it('an enum field needs options', () => {
    expect(CreateContactFieldSchema.safeParse({ key: 'level', label: { tr: 'Seviye' }, kind: 'enum' }).success).toBe(false);
    expect(
      CreateContactFieldSchema.safeParse({ key: 'level', label: { tr: 'Seviye', en: 'Level' }, kind: 'enum', options: ['A'] }).success,
    ).toBe(true);
  });

  it('refuses to merge a contact into itself', () => {
    const id = '3f0e3c7a-4b1d-4c8e-9f2a-1b2c3d4e5f60';
    expect(MergeContactsSchema.safeParse({ survivorId: id, mergedId: id }).success).toBe(false);
  });

  it('caps the contact page size and defaults the attribution model to last touch', () => {
    expect(ContactListQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
    const q = AttributionReportQuerySchema.parse({ from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' });
    expect(q.model).toBe('LAST_TOUCH');
    expect(q.groupBy).toBe('source');
    expect(
      AttributionReportQuerySchema.safeParse({ from: '2026-10-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' }).success,
    ).toBe(false);
  });
});
