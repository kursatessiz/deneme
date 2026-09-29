import { NextRequest } from 'next/server';

process.env.API_INTERNAL_URL = 'http://api.internal:4000';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET, POST } = require('./route') as typeof import('./route');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function browserRequest(path: string, body: unknown, cookies = ''): NextRequest {
  return new NextRequest(`http://panel.local/api/bff/${path}`, {
    method: 'POST',
    headers: {
      origin: 'http://panel.local',
      host: 'panel.local',
      'x-requested-with': 'platform-web',
      'content-type': 'application/json',
      ...(cookies ? { cookie: cookies } : {}),
    },
    body: JSON.stringify(body),
  });
}

const params = (path: string) => ({ params: Promise.resolve({ path: path.split('/') }) });

describe('BFF route', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('turns login tokens into httpOnly cookies and never returns them in the body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: 'acc-1', refreshToken: 'ref-1', user: { id: 'u1' } }));
    const res = await POST(browserRequest('auth/login', { emailOrPhone: 'x', password: 'y' }), params('auth/login'));

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ user: { id: 'u1' } });
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('pw_access=acc-1');
    expect(setCookie).toContain('pw_refresh=ref-1');
    expect(setCookie.toLowerCase()).toContain('httponly');
  });

  it('replays the same request body after refreshing an expired access token', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'expired' }, 401))
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'acc-2', refreshToken: 'ref-2' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const res = await POST(
      browserRequest('schedules/book', { scheduleId: 's1' }, 'pw_access=old; pw_refresh=ref-1'),
      params('schedules/book'),
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retryInit = fetchMock.mock.calls[2][1] as RequestInit;
    const retryBody = new TextDecoder().decode(retryInit.body as ArrayBuffer);
    expect(JSON.parse(retryBody)).toEqual({ scheduleId: 's1' });
    expect((retryInit.headers as Headers).get('authorization')).toBe('Bearer acc-2');
  });

  it('passes a binary XLSX download through byte for byte with its type and filename', async () => {
    // A zip header plus bytes that are not valid UTF-8: any text decoding would change them.
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe, 0x80, 0x0d, 0x0a]);
    const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    fetchMock.mockResolvedValueOnce(
      new Response(bytes, { status: 200, headers: { 'content-type': xlsx, 'content-disposition': 'attachment; filename="accounting-sales-2026-09-01_2026-09-30.xlsx"' } }),
    );
    const req = new NextRequest('http://panel.local/api/bff/studios/s1/accounting/export?format=xlsx', {
      method: 'GET',
      headers: { host: 'panel.local', cookie: 'pw_access=acc-1' },
    });

    const res = await GET(req, params('studios/s1/accounting/export'));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(xlsx);
    expect(res.headers.get('content-disposition')).toContain('.xlsx');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it('rejects state-changing calls without the CSRF header', async () => {
    const req = new NextRequest('http://panel.local/api/bff/auth/login', {
      method: 'POST',
      headers: { origin: 'http://panel.local', host: 'panel.local', 'content-type': 'application/json' },
      body: '{}',
    });
    const res = await POST(req, params('auth/login'));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
