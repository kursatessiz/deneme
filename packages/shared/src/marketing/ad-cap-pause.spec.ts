import { AD_ENTITY_PAUSED_STATUS, adCapPauseKey, isActiveAdEntityStatus, isAdPauseCapable, planAdCapPauses } from './ad-cap-pause';
import { MARKETING_SETTINGS_DEFAULTS, UpdateMarketingSettingsSchema } from './settings';

describe('ad cap auto-pause planning', () => {
  it('recognises the active status word of each platform and never treats a paused or removed campaign as active', () => {
    expect(isActiveAdEntityStatus('META', 'ACTIVE')).toBe(true);
    expect(isActiveAdEntityStatus('GOOGLE', 'ENABLED')).toBe(true);
    expect(isActiveAdEntityStatus('GOOGLE', 'enabled')).toBe(true);
    expect(isActiveAdEntityStatus('GOOGLE', 'PAUSED')).toBe(false);
    expect(isActiveAdEntityStatus('GOOGLE', 'REMOVED')).toBe(false);
    expect(isActiveAdEntityStatus('META', 'ENABLED')).toBe(false);
    expect(isActiveAdEntityStatus('UNKNOWN', 'ACTIVE')).toBe(false);
    expect(AD_ENTITY_PAUSED_STATUS).toBe('PAUSED');
  });

  it('only Meta and Google can be paused', () => {
    expect(isAdPauseCapable('META')).toBe(true);
    expect(isAdPauseCapable('GOOGLE')).toBe(true);
    expect(isAdPauseCapable('TIKTOK')).toBe(false);
  });

  it('plans the active campaigns of the capable platforms and skips the ones paused this month', () => {
    const plan = planAdCapPauses({
      platformsWithSpend: ['META', 'GOOGLE'],
      campaigns: [
        { platform: 'META', externalId: '1', status: 'ACTIVE' },
        { platform: 'META', externalId: '2', status: 'ACTIVE' },
        { platform: 'META', externalId: '3', status: 'PAUSED' },
        { platform: 'GOOGLE', externalId: '1', status: 'ENABLED' },
        { platform: 'TIKTOK', externalId: '9', status: 'ENABLE' },
      ],
      alreadyPaused: new Set([adCapPauseKey('META', '2')]),
    });
    expect(plan.toPause.map((c) => adCapPauseKey(c.platform, c.externalId))).toEqual(['META:1', 'GOOGLE:1']);
    expect(plan.unsupportedPlatforms).toEqual([]);
  });

  it('reports a platform without a pause capability and leaves its campaigns alone', () => {
    const plan = planAdCapPauses({
      platformsWithSpend: ['TIKTOK', 'META', 'TIKTOK'],
      campaigns: [
        { platform: 'TIKTOK', externalId: '9', status: 'ENABLE' },
        { platform: 'GOOGLE', externalId: '5', status: 'ENABLED' },
      ],
      alreadyPaused: new Set(),
    });
    expect(plan.toPause).toEqual([]);
    expect(plan.unsupportedPlatforms).toEqual(['TIKTOK']);
  });

  it('does not list one campaign twice', () => {
    const plan = planAdCapPauses({
      platformsWithSpend: ['META'],
      campaigns: [
        { platform: 'META', externalId: '1', status: 'ACTIVE' },
        { platform: 'META', externalId: '1', status: 'ACTIVE' },
      ],
      alreadyPaused: new Set(),
    });
    expect(plan.toPause).toHaveLength(1);
  });
});

describe('adCapAutoPause setting', () => {
  it('is off by default and editable as a boolean only', () => {
    expect(MARKETING_SETTINGS_DEFAULTS.adCapAutoPause).toBe(false);
    expect(UpdateMarketingSettingsSchema.safeParse({ adCapAutoPause: true }).success).toBe(true);
    expect(UpdateMarketingSettingsSchema.safeParse({ adCapAutoPause: 'yes' }).success).toBe(false);
  });
});
