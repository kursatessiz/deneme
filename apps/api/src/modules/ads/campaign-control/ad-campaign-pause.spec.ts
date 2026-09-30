import { CredentialCipher } from '../../../common/crypto/credential-cipher';
import { AdsHttpClient } from '../ads-http-client';
import { AdCampaignPauseService } from './ad-campaign-pause.service';
import { InvalidAdIdError, buildGooglePauseRequest, buildMetaPauseRequest } from './pause-requests';

describe('pause request builders', () => {
  it('builds a Meta status update with the token in the body, not the URL', () => {
    const request = buildMetaPauseRequest('120210000000001', 'tok-secret');
    expect(request.url).toMatch(/^https:\/\/graph\.facebook\.com\/v[\d.]+\/120210000000001$/);
    expect(request.url).not.toContain('tok-secret');
    expect(request.form).toEqual({ status: 'PAUSED', access_token: 'tok-secret' });
  });

  it('builds a Google Ads campaigns:mutate update of status only', () => {
    const request = buildGooglePauseRequest('123-456-7890', '555');
    expect(request.url).toMatch(/^https:\/\/googleads\.googleapis\.com\/v\d+\/customers\/1234567890\/campaigns:mutate$/);
    expect(request.body.operations).toEqual([{ updateMask: 'status', update: { resourceName: 'customers/1234567890/campaigns/555', status: 'PAUSED' } }]);
  });

  it('refuses a non-numeric id so nothing can be injected into a path', () => {
    expect(() => buildMetaPauseRequest('12/../x', 't')).toThrow(InvalidAdIdError);
    expect(() => buildGooglePauseRequest('1234567890', '5 or 1=1')).toThrow(InvalidAdIdError);
  });
});

describe('AdCampaignPauseService', () => {
  const cipher = { decrypt: (v: string) => v } as unknown as CredentialCipher;
  let http: { postForm: jest.Mock; postJson: jest.Mock };
  let service: AdCampaignPauseService;
  const meta = { platform: 'META', externalAccountId: 'act_1', encryptedCredentials: JSON.stringify({ accessToken: 'tok', pixelId: '12345' }) };
  const google = {
    platform: 'GOOGLE',
    externalAccountId: '1234567890',
    encryptedCredentials: JSON.stringify({ clientId: 'c', clientSecret: 's', refreshToken: 'r', developerToken: 'd', loginCustomerId: '1234567890', customerId: '1234567890', conversionId: 'AW-1' }),
  };

  beforeEach(() => {
    http = { postForm: jest.fn(), postJson: jest.fn() };
    service = new AdCampaignPauseService(cipher, http as unknown as AdsHttpClient);
  });

  it('pauses a Meta campaign through the Graph API', async () => {
    http.postForm.mockResolvedValue({ ok: true, status: 200, body: { success: true } });
    expect(await service.pause(meta, '999')).toEqual({ ok: true });
    expect(http.postForm).toHaveBeenCalledWith('META', expect.stringContaining('/999'), {}, { status: 'PAUSED', access_token: 'tok' });
  });

  it('refreshes the Google token and mutates the campaign status', async () => {
    http.postJson
      .mockResolvedValueOnce({ ok: true, status: 200, body: { access_token: 'at' } })
      .mockResolvedValueOnce({ ok: true, status: 200, body: { results: [{}] } });
    expect(await service.pause(google, '555')).toEqual({ ok: true });
    const [, url, headers, body] = http.postJson.mock.calls[1] as [string, string, Record<string, string>, { operations: unknown[] }];
    expect(url).toContain('/customers/1234567890/campaigns:mutate');
    expect(headers.authorization).toBe('Bearer at');
    expect(body.operations).toHaveLength(1);
  });

  it('reports a platform failure without leaking the credential', async () => {
    http.postForm.mockResolvedValue({ ok: false, status: 400, body: { error: { message: 'Invalid campaign' } } });
    const outcome = await service.pause(meta, '999');
    expect(outcome).toEqual({ ok: false, unsupported: false, error: 'META 400: Invalid campaign' });
    expect(JSON.stringify(outcome)).not.toContain('tok');
  });

  it('turns a thrown error into a failed outcome', async () => {
    http.postForm.mockRejectedValue(new Error('timeout'));
    expect(await service.pause(meta, '999')).toEqual({ ok: false, unsupported: false, error: 'timeout' });
  });

  it('does not call any adapter for a platform without the capability', async () => {
    const outcome = await service.pause({ platform: 'TIKTOK', externalAccountId: '1', encryptedCredentials: '{}' }, '9');
    expect(outcome).toMatchObject({ ok: false, unsupported: true });
    expect(http.postForm).not.toHaveBeenCalled();
    expect(http.postJson).not.toHaveBeenCalled();
    expect(service.supports('TIKTOK')).toBe(false);
    expect(service.supports('META')).toBe(true);
  });
});
