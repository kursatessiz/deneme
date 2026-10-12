const openURL = jest.fn();
jest.mock('react-native', () => ({ Linking: { openURL: (...args: unknown[]) => openURL(...args) } }));

import { isOpenableUrl, openExternalUrl } from './externalLink';

describe('isOpenableUrl', () => {
  it('accepts https URLs', () => {
    expect(isOpenableUrl('https://example.com/pay?id=1')).toBe(true);
    expect(isOpenableUrl('HTTPS://example.com')).toBe(true);
  });

  it('rejects other schemes, malformed values and credentials', () => {
    for (const bad of [
      'http://example.com',
      'javascript:alert(1)',
      'intent://scan#Intent;scheme=zxing;end',
      'file:///etc/passwd',
      'tel:+905551112233',
      'myapp://deep/link',
      'https://',
      'https:///path',
      'https://user:pw@example.com/',
      ' https://example.com',
      '//example.com',
      'example.com',
      '',
      null,
      undefined,
    ]) {
      expect(isOpenableUrl(bad as string | null | undefined)).toBe(false);
    }
  });

  it('allows only the schemes a caller names', () => {
    expect(isOpenableUrl('webcal://example.com/calendar/abc.ics')).toBe(false);
    expect(isOpenableUrl('webcal://example.com/calendar/abc.ics', ['webcal:'])).toBe(true);
    expect(isOpenableUrl('javascript:alert(1)', ['webcal:'])).toBe(false);
  });
});

describe('openExternalUrl', () => {
  beforeEach(() => openURL.mockReset());

  it('opens an https URL', async () => {
    await openExternalUrl('https://example.com/x');
    expect(openURL).toHaveBeenCalledWith('https://example.com/x');
  });

  it('throws without opening a blocked URL', async () => {
    await expect(openExternalUrl('javascript:alert(1)')).rejects.toThrow();
    await expect(openExternalUrl(null)).rejects.toThrow();
    expect(openURL).not.toHaveBeenCalled();
  });
});
