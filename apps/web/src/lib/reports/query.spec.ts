import { buildReportQuery, withReportQuery } from './query';

describe('buildReportQuery', () => {
  it('is empty when no filters are set', () => {
    expect(buildReportQuery({})).toBe('');
  });

  it('includes from/to as ISO strings', () => {
    const qs = buildReportQuery({ from: new Date(Date.UTC(2026, 0, 1)), to: new Date(Date.UTC(2026, 0, 31)) });
    const params = new URLSearchParams(qs);
    expect(params.get('from')).toBe('2026-01-01T00:00:00.000Z');
    expect(params.get('to')).toBe('2026-01-31T00:00:00.000Z');
  });

  it('includes branchId, granularity and format only when set', () => {
    const qs = buildReportQuery({ branchId: 'b1', granularity: 'week', format: 'csv' });
    const params = new URLSearchParams(qs);
    expect(params.get('branchId')).toBe('b1');
    expect(params.get('granularity')).toBe('week');
    expect(params.get('format')).toBe('csv');
    expect(params.has('from')).toBe(false);
  });

  it('omits null/undefined fields', () => {
    const qs = buildReportQuery({ from: null, to: undefined, branchId: null });
    expect(qs).toBe('');
  });
});

describe('withReportQuery', () => {
  it('appends nothing when there are no filters', () => {
    expect(withReportQuery('reports/studio/s1/revenue', {})).toBe('reports/studio/s1/revenue');
  });

  it('appends a ? and the query string when filters are set', () => {
    const path = withReportQuery('reports/studio/s1/revenue', { branchId: 'b1' });
    expect(path).toBe('reports/studio/s1/revenue?branchId=b1');
  });
});
