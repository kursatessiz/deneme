import {
  ClientErrorEventSchema,
  ErrorBatchSchema,
  ErrorDedupeWindow,
  ERROR_LIMITS,
  alertCooldownPassed,
  errorCodeFromId,
  errorFingerprint,
  errorGroupTitle,
  isCriticalRoute,
  isErrorCode,
  isRegression,
  isValidRequestId,
  normalizeErrorMessage,
  normalizeRoute,
  sampleEvent,
  scrubBreadcrumbs,
  scrubPii,
  scrubRecord,
  topInAppFrame,
} from './error-reporting';

describe('scrubPii', () => {
  it('masks phone numbers in common formats', () => {
    expect(scrubPii('call +90 532 100 00 02 now')).toBe('call [phone] now');
    expect(scrubPii('phone 05321000002.')).toBe('phone [phone].');
    expect(scrubPii('us (415) 555-2671 ok')).toBe('us [phone] ok');
    expect(scrubPii('+905321000002')).toBe('[phone]');
  });

  it('keeps short numbers, dates, ids and amounts', () => {
    expect(scrubPii('retry 3 of 5 after 1000 ms')).toBe('retry 3 of 5 after 1000 ms');
    expect(scrubPii('at 2026-09-29 12:30')).toBe('at 2026-09-29 12:30');
    expect(scrubPii('amount 1234.56 EUR')).toBe('amount 1234.56 EUR');
    expect(scrubPii('id 0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d')).toBe('id 0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d');
  });

  it('masks card-like digit sequences (Luhn)', () => {
    expect(scrubPii('card 4111 1111 1111 1111 declined')).toBe('card [card] declined');
    expect(scrubPii('card 4111-1111-1111-1111')).toBe('card [card]');
  });

  it('masks emails, also inside URLs', () => {
    expect(scrubPii('user ada.lovelace+x@example.com.tr failed')).toBe('user [email] failed');
    expect(scrubPii('GET https://api.example.com/users/a@b.io?x=1')).toBe('GET https://api.example.com/users/[email]?x=1');
    expect(scrubPii('scoped @nestjs/core and node_modules/.pnpm/@nestjs+core@11.2.6/x.js')).toContain('@nestjs/core');
  });

  it('masks JWTs and bearer credentials', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdEFGHijklMNOP';
    expect(scrubPii(`token ${jwt}`)).not.toContain('eyJ');
    expect(scrubPii('Authorization: Bearer abc.def.ghi')).toBe('Authorization: [redacted] [redacted]');
    expect(scrubPii('header bearer s3cr3t-value')).toBe('header bearer [redacted]');
  });

  it('masks password-like fields in text, query strings and JSON', () => {
    expect(scrubPii('login password=hunter2 user=ada')).toBe('login password=[redacted] user=ada');
    expect(scrubPii('{"password":"hunter2","name":"x"}')).toBe('{"password":"[redacted]","name":"x"}');
    expect(scrubPii('/cb?access_token=abc123&state=1')).toBe('/cb?access_token=[redacted]&state=1');
    expect(scrubPii('api-key: k_live_1')).toBe('api-key: [redacted]');
    expect(scrubPii('wrong password for account')).toBe('wrong password for account');
  });

  it('masks long hex and base64 secrets but keeps paths', () => {
    expect(scrubPii('key 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08')).toBe('key [secret]');
    expect(scrubPii('k sk_liveAbCdEfGh1234567890IjKlMnOpQrStUvWxYz0987')).toBe('k [secret]');
    expect(scrubPii('at /app/apps/api/dist/modules/error-reporting/error-store.service.js:10:5')).toContain('error-store.service.js');
  });

  it('runs in linear time on very long adversarial input', () => {
    const inputs = [
      'a@'.repeat(200_000),
      '1 '.repeat(200_000),
      '+('.repeat(200_000),
      'password='.repeat(100_000),
      `${'a'.repeat(400_000)}@`,
      '9'.repeat(400_000),
      'eyJ.'.repeat(100_000),
      `${'-1'.repeat(200_000)}x`,
      'Bearer '.repeat(60_000),
    ];
    for (const input of inputs) {
      const started = Date.now();
      scrubPii(input, input.length);
      // A backtracking scanner needs minutes on 400k characters; a linear
      // one well under a second. The bound is generous for loaded CI hosts.
      expect(Date.now() - started).toBeLessThan(10_000);
    }
  });

  it('scrubs records by key and breadcrumbs', () => {
    expect(scrubRecord({ password: 'x', path: '/members', phone: '+905321000002' })).toEqual({
      password: '[redacted]',
      path: '/members',
      phone: '[phone]',
    });
    const crumbs = scrubBreadcrumbs(
      Array.from({ length: 30 }, (_, i) => ({ type: 'click' as const, at: new Date().toISOString(), message: `button ${i} ada@example.com` })),
    );
    expect(crumbs).toHaveLength(ERROR_LIMITS.breadcrumbs);
    expect(crumbs[0].message).toBe('button 10 [email]');
  });
});

describe('fingerprint', () => {
  it('normalises ids, hex strings and numbers', () => {
    expect(normalizeErrorMessage('Booking 0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d not found after 3 tries')).toBe('Booking <id> not found after <n> tries');
    expect(normalizeErrorMessage('hash deadbeef42 and cuid ckv9x0abcd1234efgh')).toBe('hash <id> and cuid <id>');
    expect(normalizeErrorMessage('a\n\n  b')).toBe('a b');
  });

  it('picks the first in-app frame without line numbers or origin', () => {
    const v8 = [
      'Error: boom',
      '    at Object.run (/app/node_modules/@nestjs/core/router.js:10:3)',
      '    at node:internal/process/task_queues:95:5',
      '    at BookingsService.create (/app/apps/api/dist/modules/bookings.service.js:120:17)',
    ].join('\n');
    expect(topInAppFrame(v8)).toBe('BookingsService.create /app/apps/api/dist/modules/bookings.service.js');
    const ff = 'onClick@https://app.example.com/_next/static/chunks/app/page-3f2a1b9c8d7e.js?v=1:1:2345\n';
    expect(topInAppFrame(ff)).toBe('onClick /_next/static/chunks/app/<id>.js');
    expect(topInAppFrame('no frames here')).toBeNull();
  });

  it('is stable across releases and occurrences, different across types', () => {
    const a = errorFingerprint({ source: 'api', type: 'TypeError', message: 'x of 12 undefined', stack: '    at f (/app/a.js:1:2)' });
    const b = errorFingerprint({ source: 'api', type: 'TypeError', message: 'x of 99 undefined', stack: '    at f (/app/a.js:7:9)' });
    const c = errorFingerprint({ source: 'api', type: 'RangeError', message: 'x of 12 undefined', stack: '    at f (/app/a.js:1:2)' });
    const d = errorFingerprint({ source: 'web', type: 'TypeError', message: 'x of 12 undefined', stack: '    at f (/app/a.js:1:2)' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });

  it('builds a scrubbed, normalised title', () => {
    expect(errorGroupTitle('Error', 'user ada@example.com has 3 items')).toBe('Error: user [email] has <n> items');
  });

  it('normalises routes', () => {
    expect(normalizeRoute('/studios/0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d/members/42?x=1')).toBe('/studios/:id/members/:id');
    expect(normalizeRoute('/ayarlar/hatalar')).toBe('/ayarlar/hatalar');
  });

  it('flags critical flows', () => {
    expect(isCriticalRoute('/auth/login')).toBe(true);
    expect(isCriticalRoute('/studios/:studioId/payments/checkout')).toBe(true);
    expect(isCriticalRoute('/studios/:studioId/members')).toBe(false);
    expect(isCriticalRoute(null)).toBe(false);
  });
});

describe('codes and ids', () => {
  it('derives an 8-character code from the event id', () => {
    expect(errorCodeFromId('7f3a9c21-0000-4000-8000-000000000000')).toBe('7F3A9C21');
    expect(isErrorCode('7F3A9C21')).toBe(true);
    expect(isErrorCode('7F3A9C2')).toBe(false);
    expect(isErrorCode('ZZZZZZZZ')).toBe(false);
  });

  it('validates request ids strictly', () => {
    expect(isValidRequestId('0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d')).toBe(true);
    expect(isValidRequestId('short')).toBe(false);
    expect(isValidRequestId('abc\r\nset-cookie: x=1 and more text')).toBe(false);
    expect(isValidRequestId('a'.repeat(65))).toBe(false);
  });
});

describe('dedupe, sampling, regression and cooldown', () => {
  it('accepts a fingerprint at most once per second per source', () => {
    const w = new ErrorDedupeWindow(1000);
    expect(w.accept('api', 'fp', 0)).toBe(true);
    expect(w.accept('api', 'fp', 500)).toBe(false);
    expect(w.accept('web', 'fp', 500)).toBe(true);
    expect(w.accept('api', 'fp', 1000)).toBe(true);
  });

  it('stays bounded', () => {
    const w = new ErrorDedupeWindow(1000, 10);
    for (let i = 0; i < 100; i++) w.accept('api', `fp${i}`, 0);
    // The oldest key was evicted, so it is accepted again inside the window.
    expect(w.accept('api', 'fp0', 1)).toBe(true);
    expect(w.accept('api', 'fp99', 1)).toBe(false);
  });

  it('samples with the given rate', () => {
    expect(sampleEvent(1, () => 0.999)).toBe(true);
    expect(sampleEvent(0, () => 0)).toBe(false);
    expect(sampleEvent(0.25, () => 0.2)).toBe(true);
    expect(sampleEvent(0.25, () => 0.3)).toBe(false);
  });

  it('reopens a resolved group only in another release', () => {
    expect(isRegression('RESOLVED', 'sha-a', 'sha-b')).toBe(true);
    expect(isRegression('RESOLVED', 'sha-a', 'sha-a')).toBe(false);
    expect(isRegression('RESOLVED', null, 'sha-a')).toBe(true);
    expect(isRegression('OPEN', 'sha-a', 'sha-b')).toBe(false);
    expect(isRegression('IGNORED', 'sha-a', 'sha-b')).toBe(false);
  });

  it('respects the alert cooldown', () => {
    const now = new Date('2026-09-29T12:00:00Z');
    expect(alertCooldownPassed(null, now, 3600_000)).toBe(true);
    expect(alertCooldownPassed(new Date('2026-09-29T11:30:00Z'), now, 3600_000)).toBe(false);
    expect(alertCooldownPassed(new Date('2026-09-29T11:00:00Z'), now, 3600_000)).toBe(true);
  });
});

describe('schemas', () => {
  const base = {
    eventId: '7f3a9c21-0000-4000-8000-000000000000',
    source: 'web',
    release: 'sha-abc123',
    environment: 'production',
    type: 'TypeError',
    message: 'boom',
    timestamp: new Date().toISOString(),
  };

  it('strips a client supplied studioId and userIdHash', () => {
    const parsed = ClientErrorEventSchema.parse({ ...base, studioId: '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d', userIdHash: 'x' });
    expect(parsed).not.toHaveProperty('studioId');
    expect(parsed).not.toHaveProperty('userIdHash');
  });

  it('rejects server-only sources, oversized batches and fields', () => {
    expect(ClientErrorEventSchema.safeParse({ ...base, source: 'api' }).success).toBe(false);
    expect(ClientErrorEventSchema.safeParse({ ...base, stack: 'x'.repeat(ERROR_LIMITS.stackLength + 1) }).success).toBe(false);
    expect(ClientErrorEventSchema.safeParse({ ...base, release: 'bad release' }).success).toBe(false);
    expect(ErrorBatchSchema.safeParse({ events: Array.from({ length: ERROR_LIMITS.batchItems + 1 }, () => base) }).success).toBe(false);
    expect(ErrorBatchSchema.safeParse({ events: [base] }).success).toBe(true);
  });
});
