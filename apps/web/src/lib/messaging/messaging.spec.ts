import { safeRedirectTarget } from './redirect';
import { isTrackingToken } from './tokens';

describe('click redirect target', () => {
  it('accepts absolute http(s) URLs only', () => {
    expect(safeRedirectTarget('https://studio.example.com/offer?utm_source=email')).toBe('https://studio.example.com/offer?utm_source=email');
    expect(safeRedirectTarget('http://example.com/')).toBe('http://example.com/');
  });

  it('rejects script, relative, credentialed and non-string targets', () => {
    for (const bad of ['javascript:alert(1)', '//evil.example.com', '/relative', 'https://user:pw@evil.example.com', 'data:text/html,x', 42, null]) {
      expect(safeRedirectTarget(bad)).toBeNull();
    }
  });
});

describe('tracking token shape', () => {
  it('accepts the API token format and nothing else', () => {
    expect(isTrackingToken('djE6YzoxMTExMTExMS0yMjIy.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG')).toBe(true);
    expect(isTrackingToken('../../admin')).toBe(false);
    expect(isTrackingToken('a.b')).toBe(false);
    expect(isTrackingToken('https://evil.example.com')).toBe(false);
  });
});
