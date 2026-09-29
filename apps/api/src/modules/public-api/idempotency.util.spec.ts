import { IDEMPOTENCY_CLAIM_STALE_MS, canonicalJson, classifyExistingClaim, hashPublicRequest } from './idempotency.util';

describe('canonicalJson', () => {
  it('ignores key order at every level and drops undefined values', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } })).toBe(canonicalJson({ a: { c: null, d: [3, { x: 2, y: 1 }] }, b: 1, z: undefined }));
  });

  it('keeps array order and value types apart', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson({ a: '1' })).not.toBe(canonicalJson({ a: 1 }));
  });
});

describe('hashPublicRequest', () => {
  it('is the same for the same request and different for a different body, path or method', () => {
    const base = hashPublicRequest('POST', '/v1/public/contacts', { email: 'a@b.co', tags: ['x'] });
    expect(hashPublicRequest('post', '/v1/public/contacts', { tags: ['x'], email: 'a@b.co' })).toBe(base);
    expect(hashPublicRequest('POST', '/v1/public/contacts', { email: 'a@b.co', tags: ['y'] })).not.toBe(base);
    expect(hashPublicRequest('POST', '/v1/public/contacts/x/tags', { email: 'a@b.co', tags: ['x'] })).not.toBe(base);
    expect(hashPublicRequest('PUT', '/v1/public/contacts', { email: 'a@b.co', tags: ['x'] })).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('classifyExistingClaim', () => {
  const now = new Date('2026-10-27T12:00:00.000Z');
  const record = (over: Partial<{ requestHash: string; status: string; createdAt: Date }> = {}) => ({ requestHash: 'h1', status: 'DONE', createdAt: now, ...over });

  it('refuses the same key with another request, whatever the state', () => {
    expect(classifyExistingClaim(record(), 'h2', now)).toEqual({ kind: 'MISMATCH' });
    expect(classifyExistingClaim(record({ status: 'IN_PROGRESS' }), 'h2', now)).toEqual({ kind: 'MISMATCH' });
  });

  it('replays a finished request', () => {
    expect(classifyExistingClaim(record(), 'h1', now)).toEqual({ kind: 'REPLAY' });
  });

  it('reports an unfinished request as in progress until the claim is stale', () => {
    const fresh = record({ status: 'IN_PROGRESS', createdAt: new Date(now.getTime() - 1000) });
    expect(classifyExistingClaim(fresh, 'h1', now)).toEqual({ kind: 'IN_PROGRESS' });
    const stale = record({ status: 'IN_PROGRESS', createdAt: new Date(now.getTime() - IDEMPOTENCY_CLAIM_STALE_MS - 1) });
    expect(classifyExistingClaim(stale, 'h1', now)).toEqual({ kind: 'STALE' });
  });
});
