import {
  BASE_MESSAGES,
  ERROR_BASELINE_BUCKETS,
  ERROR_BUCKET_MS,
  ERROR_SPIKE_DEFAULTS,
  ErrorFeedbackSchema,
  ErrorSettingsUpdateSchema,
  bucketStartOf,
  buildAlertWebhookPayload,
  buildSlackAlertPayload,
  createTranslator,
  detectSpike,
  escapeSlackText,
  extractSourceContext,
  followMergeChain,
  isSlackWebhookUrl,
  observedBaselineBuckets,
  parseSourceContexts,
  resolveSpikeSettings,
  scrubFeedback,
} from './index';
import type { ErrorAlertNotification } from './index';

const settings = ERROR_SPIKE_DEFAULTS;

describe('spike detection', () => {
  it('aligns buckets to 15 minutes in UTC', () => {
    expect(bucketStartOf(new Date('2026-10-29T10:14:59.999Z')).toISOString()).toBe('2026-10-29T10:00:00.000Z');
    expect(bucketStartOf(new Date('2026-10-29T10:15:00.000Z')).toISOString()).toBe('2026-10-29T10:15:00.000Z');
  });

  it('flags a window at ratio x the baseline mean', () => {
    // 96 buckets, 2 events each: mean 2, ratio 5 -> threshold 10 (also the minimum window count).
    expect(detectSpike({ windowCount: 10, baselineTotal: 192, observedBuckets: 96 }, settings)).toEqual({
      spike: true,
      mode: 'RATIO',
      baselineMean: 2,
      threshold: 10,
    });
    expect(detectSpike({ windowCount: 9, baselineTotal: 192, observedBuckets: 96 }, settings).spike).toBe(false);
    // Busier baseline: mean 20 -> threshold 100.
    const busy = detectSpike({ windowCount: 99, baselineTotal: 1920, observedBuckets: 96 }, settings);
    expect(busy).toMatchObject({ spike: false, mode: 'RATIO', baselineMean: 20, threshold: 100 });
    expect(detectSpike({ windowCount: 100, baselineTotal: 1920, observedBuckets: 96 }, settings).spike).toBe(true);
  });

  it('never alerts below the minimum window count, whatever the ratio', () => {
    // Tiny mean (0.25) but the baseline has enough events: 5 events is 20x the mean and still not a spike.
    expect(detectSpike({ windowCount: 5, baselineTotal: 24, observedBuckets: 96 }, settings)).toMatchObject({ spike: false, mode: 'RATIO', threshold: 10 });
  });

  it('counts a first-seen group only above the absolute floor', () => {
    const first = detectSpike({ windowCount: 49, baselineTotal: 0, observedBuckets: 0 }, settings);
    expect(first).toEqual({ spike: false, mode: 'ABSOLUTE', baselineMean: 0, threshold: 50 });
    expect(detectSpike({ windowCount: 50, baselineTotal: 0, observedBuckets: 0 }, settings).spike).toBe(true);
  });

  it('falls back to the absolute floor when the baseline is thinner than the minimum sample', () => {
    // 19 events in 24 h is below minBaselineEvents (20): a ratio on 19 events would be noise.
    const thin = detectSpike({ windowCount: 30, baselineTotal: 19, observedBuckets: 96 }, settings);
    expect(thin).toMatchObject({ spike: false, mode: 'ABSOLUTE', threshold: 50 });
    expect(detectSpike({ windowCount: 30, baselineTotal: 20, observedBuckets: 96 }, settings)).toMatchObject({ spike: true, mode: 'RATIO', threshold: 10 });
  });

  it('uses only the buckets a young group has existed, not a diluted 96', () => {
    // Existed 4 buckets with 40 events: mean 10, threshold 50. Diluted over 96 buckets it would be 0.42 and alert at 10.
    expect(detectSpike({ windowCount: 30, baselineTotal: 40, observedBuckets: 4 }, settings)).toMatchObject({ spike: false, baselineMean: 10, threshold: 50 });
  });

  it('is off when disabled and tolerates hostile numbers', () => {
    expect(detectSpike({ windowCount: 1000, baselineTotal: 0, observedBuckets: 0 }, { ...settings, enabled: false }).spike).toBe(false);
    expect(detectSpike({ windowCount: Number.NaN, baselineTotal: -5, observedBuckets: Number.POSITIVE_INFINITY }, settings).spike).toBe(false);
    expect(detectSpike({ windowCount: 1e9, baselineTotal: 10, observedBuckets: 1000 }, settings).spike).toBe(true);
  });

  it('counts the observed baseline buckets from the first-seen bucket', () => {
    const windowStart = new Date('2026-10-29T12:00:00.000Z');
    expect(observedBaselineBuckets(new Date('2026-10-29T12:05:00.000Z'), windowStart)).toBe(0);
    expect(observedBaselineBuckets(new Date('2026-10-29T11:59:00.000Z'), windowStart)).toBe(1);
    expect(observedBaselineBuckets(new Date('2026-10-29T11:00:00.000Z'), windowStart)).toBe(4);
    expect(observedBaselineBuckets(new Date('2026-10-01T00:00:00.000Z'), windowStart)).toBe(ERROR_BASELINE_BUCKETS);
    expect(ERROR_BUCKET_MS).toBe(900_000);
  });

  it('merges stored partial settings over the defaults and ignores invalid keys', () => {
    expect(resolveSpikeSettings({ ratio: 8, minWindowCount: 'x', absoluteFloor: 0 })).toEqual({ ...ERROR_SPIKE_DEFAULTS, ratio: 8 });
    expect(resolveSpikeSettings(null)).toEqual(ERROR_SPIKE_DEFAULTS);
    expect(resolveSpikeSettings([1])).toEqual(ERROR_SPIKE_DEFAULTS);
  });
});

describe('merge chain', () => {
  const parents: Record<string, string | null> = { a: 'b', b: 'c', c: null, x: 'y', y: 'x', solo: null };
  const parentOf = (id: string): string | null => parents[id] ?? null;

  it('follows merged-into links to the live group', () => {
    expect(followMergeChain('a', parentOf)).toBe('c');
    expect(followMergeChain('c', parentOf)).toBe('c');
    expect(followMergeChain('solo', parentOf)).toBe('solo');
  });

  it('refuses a cycle and an overlong chain', () => {
    expect(followMergeChain('x', parentOf)).toBeNull();
    const long = (id: string): string | null => `${id}n`;
    expect(followMergeChain('n', long)).toBeNull();
  });
});

describe('alert sinks', () => {
  const notification: ErrorAlertNotification = {
    alertId: '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d',
    kind: 'SPIKE',
    groupId: '11111111-2222-4333-8444-555555555555',
    title: 'TypeError: <script> & "quotes"',
    source: 'web',
    release: 'sha-abc',
    code: 'ABCDEF12',
    windowCount: 42,
    baselineMean: 3.5,
    threshold: 18,
    affectedStudioCount: 4,
    occurredAt: '2026-10-29T10:15:00.000Z',
    link: 'https://app.example.com/admin/hatalar/11111111-2222-4333-8444-555555555555',
  };
  const t = createTranslator({ locale: 'en', messages: BASE_MESSAGES, fallback: BASE_MESSAGES });

  it('builds the Slack payload with escaped text, facts and a link button', () => {
    const payload = buildSlackAlertPayload(notification, t);
    expect(payload.text).toContain('&lt;script&gt; &amp; "quotes"');
    expect(payload.text).not.toContain('<script>');
    expect(payload.blocks.map((b) => b.type)).toEqual(['header', 'section', 'section', 'actions']);
    const json = JSON.stringify(payload);
    expect(json).toContain('42');
    expect(json).toContain('ABCDEF12');
    expect(json).toContain(notification.link);
    // The Turkish base catalogue is used when the locale is Turkish: no raw keys leak into the message.
    expect(json).not.toContain('adminErrors.');
  });

  it('builds a Slack payload for each alert kind without missing keys', () => {
    for (const kind of ['SPIKE', 'NEW_GROUP', 'REGRESSION'] as const) {
      const json = JSON.stringify(buildSlackAlertPayload({ ...notification, kind }, t));
      expect(json).not.toContain('adminErrors.');
    }
  });

  it('builds the generic webhook payload without stack or message fields', () => {
    const payload = buildAlertWebhookPayload(notification);
    expect(payload.event).toBe('error.alert');
    expect(payload.version).toBe(1);
    expect(payload.alert).toMatchObject({ id: notification.alertId, kind: 'SPIKE', windowCount: 42, threshold: 18, link: notification.link });
    expect(Object.keys(payload.alert)).not.toContain('stack');
    expect(Object.keys(payload.alert)).not.toContain('message');
  });

  it('escapes Slack control characters', () => {
    expect(escapeSlackText('a<b>&c')).toBe('a&lt;b&gt;&amp;c');
  });

  it('accepts only Slack incoming webhook URLs on the allow-listed host', () => {
    expect(isSlackWebhookUrl('https://hooks.slack.com/services/T000/B000/xxxx')).toBe(true);
    expect(isSlackWebhookUrl('http://hooks.slack.com/services/T000/B000/xxxx')).toBe(false);
    expect(isSlackWebhookUrl('https://hooks.slack.com.evil.example/services/T000/B000/xxxx')).toBe(false);
    expect(isSlackWebhookUrl('https://evil.example/services/T000/B000/xxxx')).toBe(false);
    expect(isSlackWebhookUrl('https://user:pw@hooks.slack.com/services/T000/B000/xxxx')).toBe(false);
    expect(isSlackWebhookUrl('https://hooks.slack.com:8443/services/T000/B000/xxxx')).toBe(false);
    expect(isSlackWebhookUrl('https://hooks.slack.com/other')).toBe(false);
    expect(isSlackWebhookUrl('not a url')).toBe(false);
  });

  it('validates the settings update body', () => {
    expect(ErrorSettingsUpdateSchema.safeParse({ slack: { url: 'https://evil.example/services/a/b/c' } }).success).toBe(false);
    expect(ErrorSettingsUpdateSchema.safeParse({ webhook: { url: 'http://example.com/hook' } }).success).toBe(false);
    expect(ErrorSettingsUpdateSchema.safeParse({ webhook: { url: 'https://example.com/hook', secret: 'short' } }).success).toBe(false);
    expect(ErrorSettingsUpdateSchema.safeParse({ cooldownMinutes: 1 }).success).toBe(false);
    expect(ErrorSettingsUpdateSchema.safeParse({ spike: { ratio: 8 }, cooldownMinutes: 30, webhook: { url: null, secret: null } }).success).toBe(true);
    expect(ErrorSettingsUpdateSchema.safeParse({ unknown: 1 }).success).toBe(false);
  });
});

describe('feedback scrubbing', () => {
  it('masks e-mail, phone, card and token values and keeps ordinary text', () => {
    const out = scrubFeedback('I tapped Save, then mail me at ada@example.com or call +90 532 123 45 67. Card 4242 4242 4242 4242.');
    expect(out).toContain('I tapped Save');
    expect(out).toContain('[email]');
    expect(out).toContain('[phone]');
    expect(out).toContain('[card]');
    expect(out).not.toContain('ada@example.com');
    expect(out).not.toContain('4242');
  });

  it('cuts to 500 characters, removes control characters and trims', () => {
    expect(scrubFeedback('x'.repeat(2000))).toHaveLength(500);
    expect(scrubFeedback('  a\u0000b\u0007c\nd  ')).toBe('a b c\nd');
    expect(scrubFeedback('   ')).toBe('');
  });

  it('bounds the raw request size', () => {
    expect(ErrorFeedbackSchema.safeParse({ feedback: 'x'.repeat(1000) }).success).toBe(true);
    expect(ErrorFeedbackSchema.safeParse({ feedback: 'x'.repeat(1001) }).success).toBe(false);
  });
});

describe('source context', () => {
  const source = ['line one', 'line two', '  const total = a + b;', 'line four', 'line five'].join('\n');

  it('returns the line and one line on each side', () => {
    expect(extractSourceContext(source, 3)).toEqual({ startLine: 2, lines: ['line two', '  const total = a + b;', 'line four'], focus: 1 });
  });

  it('clamps at the start and the end of the file', () => {
    expect(extractSourceContext(source, 1)).toEqual({ startLine: 1, lines: ['line one', 'line two'], focus: 0 });
    expect(extractSourceContext(source, 5)).toEqual({ startLine: 4, lines: ['line four', 'line five'], focus: 1 });
  });

  it('returns null for a line outside the file or a bad line number', () => {
    expect(extractSourceContext(source, 6)).toBeNull();
    expect(extractSourceContext(source, 0)).toBeNull();
    expect(extractSourceContext(source, 1.5)).toBeNull();
  });

  it('handles CRLF, tabs and long lines, and scrubs secrets', () => {
    const out = extractSourceContext(`a\r\n\tb ada@example.com\r\n${'x'.repeat(500)}`, 2);
    expect(out?.lines[0]).toBe('a');
    expect(out?.lines[1]).toBe('  b [email]');
    expect(out?.lines[2]).toHaveLength(200);
  });

  it('parses stored context back and drops malformed entries', () => {
    const good = { location: 'src/a.ts:3:4', startLine: 2, lines: ['a', 'b', 'c'], focus: 1 };
    expect(parseSourceContexts([good, { location: 1 }, null])).toEqual([good]);
    expect(parseSourceContexts('nope')).toEqual([]);
  });
});
