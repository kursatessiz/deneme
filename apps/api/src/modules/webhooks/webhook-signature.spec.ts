import { buildSignatureHeader, signWebhookPayload, verifySignatureHeader } from './webhook-signature';

describe('webhook-signature', () => {
  const secret = 'whsec_test_secret';
  const body = JSON.stringify({ event: 'booking.created', data: { id: '1' } });

  it('builds a header in the t=<ts>,v1=<hex> shape', () => {
    const header = buildSignatureHeader(secret, body, new Date(1700000000000));
    expect(header).toBe(`t=1700000000,v1=${signWebhookPayload(secret, 1700000000, body)}`);
  });

  it('round-trips: a header this module built verifies with the same secret', () => {
    const header = buildSignatureHeader(secret, body);
    expect(verifySignatureHeader(secret, body, header)).toBe(true);
  });

  it('rejects a signature built with a different secret', () => {
    const header = buildSignatureHeader('a-different-secret', body);
    expect(verifySignatureHeader(secret, body, header)).toBe(false);
  });

  it('rejects a tampered body', () => {
    const header = buildSignatureHeader(secret, body);
    expect(verifySignatureHeader(secret, body + 'tampered', header)).toBe(false);
  });

  it('rejects a header older than the allowed age', () => {
    const old = buildSignatureHeader(secret, body, new Date(Date.now() - 10 * 60 * 1000));
    expect(verifySignatureHeader(secret, body, old, 5 * 60)).toBe(false);
  });

  it('rejects a malformed header', () => {
    expect(verifySignatureHeader(secret, body, 'garbage')).toBe(false);
    expect(verifySignatureHeader(secret, body, 't=abc,v1=')).toBe(false);
  });
});
