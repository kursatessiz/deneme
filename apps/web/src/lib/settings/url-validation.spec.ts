import { validateEmbedOrigin, validateGoogleReviewUrl, validateWebhookUrl } from './url-validation';

describe('validateWebhookUrl', () => {
  it('accepts an https URL', () => {
    expect(validateWebhookUrl('https://example.com/hook').valid).toBe(true);
  });

  it('rejects http and malformed URLs', () => {
    expect(validateWebhookUrl('http://example.com/hook').valid).toBe(false);
    expect(validateWebhookUrl('not-a-url').valid).toBe(false);
  });
});

describe('validateEmbedOrigin', () => {
  it('accepts a bare https origin', () => {
    expect(validateEmbedOrigin('https://ornek.com').valid).toBe(true);
    expect(validateEmbedOrigin('https://ornek.com:3000').valid).toBe(true);
  });

  it('rejects a path, http, or garbage', () => {
    expect(validateEmbedOrigin('https://ornek.com/path').valid).toBe(false);
    expect(validateEmbedOrigin('http://ornek.com').valid).toBe(false);
    expect(validateEmbedOrigin('ornek.com').valid).toBe(false);
  });
});

describe('validateGoogleReviewUrl', () => {
  it('accepts an allowed Google review prefix', () => {
    expect(validateGoogleReviewUrl('https://g.page/r/abc/review').valid).toBe(true);
  });

  it('rejects an unrelated https URL', () => {
    expect(validateGoogleReviewUrl('https://example.com').valid).toBe(false);
  });
});
