import { AUDIT_METADATA_SUMMARY_MAX, AuditLogQuerySchema, summarizeAuditMetadata } from './audit';

describe('AuditLogQuerySchema', () => {
  it('defaults the page and validates the filters', () => {
    expect(AuditLogQuerySchema.parse({})).toMatchObject({ page: 1, limit: 50 });
    expect(AuditLogQuerySchema.parse({ page: '3', userId: '5b0d6a0e-0000-4000-8000-000000000001', action: 'marketing.approval' })).toMatchObject({ page: 3, action: 'marketing.approval' });
    expect(AuditLogQuerySchema.safeParse({ userId: 'nope' }).success).toBe(false);
    expect(AuditLogQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(AuditLogQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
    expect(AuditLogQuerySchema.safeParse({ unknown: '1' }).success).toBe(false);
  });

  it('rejects a period that ends before it starts', () => {
    expect(AuditLogQuerySchema.safeParse({ from: '2026-10-02T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' }).success).toBe(false);
    expect(AuditLogQuerySchema.safeParse({ from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' }).success).toBe(true);
  });
});

describe('summarizeAuditMetadata', () => {
  it('lists top level fields and shortens nested values', () => {
    expect(summarizeAuditMetadata({ from: 'SENDING', reasons: ['BOUNCE'], changes: { a: 1 }, ok: true, none: null })).toBe('from: SENDING, reasons: [1], changes: {...}, ok: true, none: null');
    expect(summarizeAuditMetadata(null)).toBe('');
    expect(summarizeAuditMetadata(undefined)).toBe('');
  });

  it('masks contact details and cuts long text', () => {
    const masked = summarizeAuditMetadata({ note: 'mail ada@example.com or call +90 532 123 45 67' });
    expect(masked).not.toContain('ada@example.com');
    expect(masked).not.toContain('532 123');
    const long = summarizeAuditMetadata({ text: 'x'.repeat(1000) });
    expect(long.length).toBeLessThanOrEqual(AUDIT_METADATA_SUMMARY_MAX);
    expect(long.endsWith('...')).toBe(true);
  });
});
