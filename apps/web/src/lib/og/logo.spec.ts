import { isPublicHttpsUrl } from './logo';

describe('isPublicHttpsUrl', () => {
  it('accepts a plain public https URL', () => {
    expect(isPublicHttpsUrl('https://cdn.example.com/logo.png')).toBe(true);
  });

  it('rejects other schemes, credentials and internal hosts', () => {
    expect(isPublicHttpsUrl('http://cdn.example.com/logo.png')).toBe(false);
    expect(isPublicHttpsUrl('https://user:pw@cdn.example.com/logo.png')).toBe(false);
    expect(isPublicHttpsUrl('https://localhost/logo.png')).toBe(false);
    expect(isPublicHttpsUrl('https://api/logo.png')).toBe(false);
    expect(isPublicHttpsUrl('https://127.0.0.1/logo.png')).toBe(false);
    expect(isPublicHttpsUrl('https://[::1]/logo.png')).toBe(false);
    expect(isPublicHttpsUrl('https://db.internal/logo.png')).toBe(false);
    expect(isPublicHttpsUrl('not a url')).toBe(false);
  });
});
