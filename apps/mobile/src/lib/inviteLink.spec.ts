import { buildAcceptBody, isInviteToken } from './inviteLink';

const TOKEN = 'A'.repeat(43);
const DOC = '123e4567-e89b-42d3-a456-426614174000';

describe('isInviteToken', () => {
  it('accepts only the 43 character base64url form', () => {
    expect(isInviteToken(TOKEN)).toBe(true);
    expect(isInviteToken('a-b_'.repeat(10) + 'abc')).toBe(true);
    for (const bad of ['', 'short', `${TOKEN}A`, `${TOKEN.slice(1)}/`, '../etc', undefined, null, 42]) expect(isInviteToken(bad)).toBe(false);
  });
});

describe('buildAcceptBody', () => {
  it('builds the body the API schema accepts, leaving the PIN out when empty', () => {
    const result = buildAcceptBody({ code: '482915', pin: '', documentIds: [DOC], device: 'mobile-ios' });
    expect(result).toEqual({ ok: true, body: { code: '482915', acceptedDocumentVersionIds: [DOC], device: 'mobile-ios' } });
  });

  it('includes a valid PIN', () => {
    const result = buildAcceptBody({ code: '482915', pin: '482916', documentIds: [], device: 'mobile-android' });
    expect(result.ok && result.body.pin).toBe('482916');
  });

  it('rejects a malformed code or PIN', () => {
    expect(buildAcceptBody({ code: '12', pin: '', documentIds: [], device: 'd' }).ok).toBe(false);
    expect(buildAcceptBody({ code: '482915', pin: '12', documentIds: [], device: 'd' }).ok).toBe(false);
  });
});
