import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE, hasValidCsrfHeader, isSameOriginRequest, methodNeedsCsrfCheck } from './csrf';

describe('methodNeedsCsrfCheck', () => {
  it('does not require the header for safe methods', () => {
    expect(methodNeedsCsrfCheck('GET')).toBe(false);
    expect(methodNeedsCsrfCheck('HEAD')).toBe(false);
    expect(methodNeedsCsrfCheck('OPTIONS')).toBe(false);
  });

  it('requires the header for state-changing methods', () => {
    expect(methodNeedsCsrfCheck('POST')).toBe(true);
    expect(methodNeedsCsrfCheck('PUT')).toBe(true);
    expect(methodNeedsCsrfCheck('PATCH')).toBe(true);
    expect(methodNeedsCsrfCheck('DELETE')).toBe(true);
    expect(methodNeedsCsrfCheck('post')).toBe(true);
  });
});

describe('hasValidCsrfHeader', () => {
  it('accepts the exact expected header', () => {
    const headers = new Headers({ [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE });
    expect(hasValidCsrfHeader(headers)).toBe(true);
  });

  it('rejects a missing or wrong header', () => {
    expect(hasValidCsrfHeader(new Headers())).toBe(false);
    expect(hasValidCsrfHeader(new Headers({ [CSRF_HEADER_NAME]: 'something-else' }))).toBe(false);
  });
});

describe('isSameOriginRequest', () => {
  it('accepts a matching origin and host', () => {
    expect(isSameOriginRequest('https://panel.example.com', 'panel.example.com')).toBe(true);
  });

  it('rejects a cross-site origin', () => {
    expect(isSameOriginRequest('https://evil.example.com', 'panel.example.com')).toBe(false);
  });

  it('rejects when either value is missing', () => {
    expect(isSameOriginRequest(null, 'panel.example.com')).toBe(false);
    expect(isSameOriginRequest('https://panel.example.com', null)).toBe(false);
  });

  it('rejects a malformed origin instead of throwing', () => {
    expect(isSameOriginRequest('not-a-url', 'panel.example.com')).toBe(false);
  });
});
