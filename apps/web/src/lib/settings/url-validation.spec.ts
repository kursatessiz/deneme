import { validateEmbedOrigin, validateGoogleReviewUrl, validateWebhookUrl } from './url-validation';

describe('validateWebhookUrl', () => {
  it('accepts an https URL', () => {
    expect(validateWebhookUrl('https://example.com/hook', { invalidAddress: 'invalid' }).valid).toBe(true);
  });

  it('rejects http and malformed URLs', () => {
    expect(validateWebhookUrl('http://example.com/hook', { invalidAddress: 'invalid' }).valid).toBe(false);
    expect(validateWebhookUrl('not-a-url', { invalidAddress: 'invalid' }).valid).toBe(false);
  });
});

describe('validateEmbedOrigin', () => {
  it('accepts a bare https origin', () => {
    expect(validateEmbedOrigin('https://ornek.com', { invalidOrigin: 'invalid' }).valid).toBe(true);
    expect(validateEmbedOrigin('https://ornek.com:3000', { invalidOrigin: 'invalid' }).valid).toBe(true);
  });

  it('rejects a path, http, or garbage', () => {
    expect(validateEmbedOrigin('https://ornek.com/path', { invalidOrigin: 'invalid' }).valid).toBe(false);
    expect(validateEmbedOrigin('http://ornek.com', { invalidOrigin: 'invalid' }).valid).toBe(false);
    expect(validateEmbedOrigin('ornek.com', { invalidOrigin: 'invalid' }).valid).toBe(false);
  });
});

describe('validateGoogleReviewUrl', () => {
  it('accepts an allowed Google review prefix', () => {
    expect(validateGoogleReviewUrl('https://g.page/r/abc/review', { invalidLink: 'invalid' }).valid).toBe(true);
  });

  it('rejects an unrelated https URL', () => {
    expect(validateGoogleReviewUrl('https://example.com', { invalidLink: 'invalid' }).valid).toBe(false);
  });
});
