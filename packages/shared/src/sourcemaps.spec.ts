import { SourcemapUploadSchema, isValidSourcemapRelease, mobileRelease, scrubPii } from './index';

describe('mobileRelease', () => {
  it('is the app version, plus the update id for an EAS Update bundle', () => {
    expect(mobileRelease('1.4.0')).toBe('1.4.0');
    expect(mobileRelease('1.4.0', null)).toBe('1.4.0');
    expect(mobileRelease('1.4.0', '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d')).toBe('1.4.0-0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d');
  });

  it('falls back to a valid value for odd input', () => {
    expect(mobileRelease(undefined)).toBe('unknown');
    expect(mobileRelease('1.0.0+5')).toBe('unknown');
    expect(mobileRelease('1.0.0', 'x'.repeat(80))).toBe('1.0.0');
    expect(isValidSourcemapRelease(mobileRelease('1.4.0', 'abc'))).toBe(true);
  });
});

describe('SourcemapUploadSchema', () => {
  const ok = { release: 'sha-abc', platform: 'web', path: '_next/static/a.js', map: '{"version":3}' };

  it('accepts a map as text or as an object and rejects unknown keys and bad releases', () => {
    expect(SourcemapUploadSchema.safeParse(ok).success).toBe(true);
    expect(SourcemapUploadSchema.safeParse({ ...ok, map: { version: 3 } }).success).toBe(true);
    expect(SourcemapUploadSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(SourcemapUploadSchema.safeParse({ ...ok, release: '../x' }).success).toBe(false);
    expect(SourcemapUploadSchema.safeParse({ ...ok, release: '.hidden' }).success).toBe(false);
    expect(SourcemapUploadSchema.safeParse({ ...ok, platform: 'api' }).success).toBe(false);
  });
});

describe('stack frames survive the PII scrubber (symbolication needs URL, line and column)', () => {
  it('keeps a browser frame with a hashed chunk name and a Hermes frame', () => {
    const web = '    at onClick (https://app.example.com/_next/static/chunks/app/%28dashboard%29/page-1a2b3c4d5e6f7a8b.js:1:2345)';
    const hermes = '    at fn (address at /data/user/0/com.platform.member/files/index.android.bundle:1:23456)';
    expect(scrubPii(web)).toBe(web);
    expect(scrubPii(hermes)).toBe(hermes);
  });
});
