import { verificationMetadata } from './verification';

describe('verificationMetadata', () => {
  it('renders nothing without a token', () => {
    expect(verificationMetadata({ googleSiteVerification: null, bingSiteVerification: null })).toBeUndefined();
  });

  it('maps the Google token to google-site-verification and the Bing token to msvalidate.01', () => {
    expect(verificationMetadata({ googleSiteVerification: 'g-token-12345', bingSiteVerification: 'B1NGTOKEN12345' })).toEqual({
      google: 'g-token-12345',
      other: { 'msvalidate.01': 'B1NGTOKEN12345' },
    });
  });

  it('keeps one tag when only one token is set', () => {
    expect(verificationMetadata({ googleSiteVerification: 'g-token-12345', bingSiteVerification: null })).toEqual({ google: 'g-token-12345' });
    expect(verificationMetadata({ googleSiteVerification: null, bingSiteVerification: 'B1NGTOKEN12345' })).toEqual({ other: { 'msvalidate.01': 'B1NGTOKEN12345' } });
  });
});
