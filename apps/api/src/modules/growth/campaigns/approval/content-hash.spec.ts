import { campaignContentHash, canonicalJson, type CampaignContentInput, type TemplateFingerprintRow } from './content-hash';

const smsTr: TemplateFingerprintRow = {
  channel: 'SMS',
  locale: 'tr',
  source: 'TENANT',
  body: 'Merhaba {firstName}, yeni ozellik yayinda. Cikis icin RET yazin.',
  subject: null,
  blocks: null,
  whatsappTemplateName: null,
  whatsappStatus: null,
  isTransactional: false,
};
const smsEn: TemplateFingerprintRow = { ...smsTr, locale: 'en', source: 'GLOBAL', body: 'Hi {firstName}, reply STOP to opt out.' };

const base: CampaignContentInput = {
  channel: 'SMS',
  channels: ['SMS'],
  templateKey: 'MKT_LAUNCH',
  templates: [smsTr, smsEn],
  segmentId: '11111111-1111-4111-8111-111111111111',
  audienceCount: 42,
  schedule: '2026-10-05T09:00:00.000Z',
};

describe('campaignContentHash', () => {
  it('is a stable sha256 hex digest', () => {
    const hash = campaignContentHash(base);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(campaignContentHash({ ...base })).toBe(hash);
  });

  it('does not depend on the order of the template rows or of object keys', () => {
    const reordered = { ...base, templates: [smsEn, smsTr] };
    expect(campaignContentHash(reordered)).toBe(campaignContentHash(base));
    const keysShuffled: TemplateFingerprintRow = {
      isTransactional: smsTr.isTransactional,
      whatsappStatus: smsTr.whatsappStatus,
      whatsappTemplateName: smsTr.whatsappTemplateName,
      blocks: smsTr.blocks,
      subject: smsTr.subject,
      body: smsTr.body,
      source: smsTr.source,
      locale: smsTr.locale,
      channel: smsTr.channel,
    };
    expect(campaignContentHash({ ...base, templates: [keysShuffled, smsEn] })).toBe(campaignContentHash(base));
  });

  it('changes when a template version changes (body, subject, email blocks, WhatsApp approval)', () => {
    const hash = campaignContentHash(base);
    expect(campaignContentHash({ ...base, templates: [{ ...smsTr, body: `${smsTr.body} ` }, smsEn] })).not.toBe(hash);
    const email: TemplateFingerprintRow = { ...smsTr, channel: 'EMAIL', subject: 'Yeni', blocks: [{ type: 'paragraph', text: 'a' }] };
    const emailHash = campaignContentHash({ ...base, templates: [email] });
    expect(campaignContentHash({ ...base, templates: [{ ...email, subject: 'Yeni!' }] })).not.toBe(emailHash);
    expect(campaignContentHash({ ...base, templates: [{ ...email, blocks: [{ type: 'paragraph', text: 'b' }] }] })).not.toBe(emailHash);
    const wa: TemplateFingerprintRow = { ...smsTr, channel: 'WHATSAPP', whatsappTemplateName: 'launch_tr', whatsappStatus: 'PENDING' };
    expect(campaignContentHash({ ...base, templates: [{ ...wa, whatsappStatus: 'APPROVED' }] })).not.toBe(campaignContentHash({ ...base, templates: [wa] }));
  });

  it('changes when a template is added or removed', () => {
    expect(campaignContentHash({ ...base, templates: [smsTr] })).not.toBe(campaignContentHash(base));
  });

  it('changes with the segment snapshot count, the segment, the schedule and the channel', () => {
    const hash = campaignContentHash(base);
    expect(campaignContentHash({ ...base, audienceCount: 43 })).not.toBe(hash);
    expect(campaignContentHash({ ...base, segmentId: '22222222-2222-4222-8222-222222222222' })).not.toBe(hash);
    expect(campaignContentHash({ ...base, schedule: '2026-10-05T10:00:00.000Z' })).not.toBe(hash);
    expect(campaignContentHash({ ...base, schedule: null })).not.toBe(hash);
    expect(campaignContentHash({ ...base, channel: null, channels: ['WHATSAPP', 'SMS'] })).not.toBe(hash);
    expect(campaignContentHash({ ...base, templateKey: 'MKT_OTHER' })).not.toBe(hash);
  });

  it('canonical JSON sorts keys at every level and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[2,{"y":2,"z":1}]},"b":1}');
  });
});
