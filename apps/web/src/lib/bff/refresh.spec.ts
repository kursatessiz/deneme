import { exchangeRefreshToken } from './refresh';

function fakeFetch(answer: Response | Error): typeof fetch {
  return (async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  }) as unknown as typeof fetch;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('exchangeRefreshToken', () => {
  it('returns the new pair on success', async () => {
    const outcome = await exchangeRefreshToken('http://api', 'r1', { fetchImpl: fakeFetch(json(200, { accessToken: 'a2', refreshToken: 'r2' })) });
    expect(outcome).toEqual({ kind: 'renewed', tokens: { accessToken: 'a2', refreshToken: 'r2' } });
  });

  it.each([401, 403])('treats %i as a rejected session (cookies may be cleared)', async (status) => {
    const outcome = await exchangeRefreshToken('http://api', 'r1', { fetchImpl: fakeFetch(json(status, { message: 'x' })) });
    expect(outcome).toEqual({ kind: 'rejected' });
  });

  it('keeps the session on a rate limit', async () => {
    const outcome = await exchangeRefreshToken('http://api', 'r1', { fetchImpl: fakeFetch(json(429, { message: 'x' })) });
    expect(outcome).toEqual({ kind: 'unavailable', status: 429 });
  });

  it.each([500, 502, 503])('keeps the session on a %i from the API', async (status) => {
    const outcome = await exchangeRefreshToken('http://api', 'r1', { fetchImpl: fakeFetch(json(status, { message: 'x' })) });
    expect(outcome).toEqual({ kind: 'unavailable', status: 503 });
  });

  it('keeps the session when the API is unreachable', async () => {
    const outcome = await exchangeRefreshToken('http://api', 'r1', { fetchImpl: fakeFetch(new TypeError('fetch failed')) });
    expect(outcome).toEqual({ kind: 'unavailable', status: 503 });
  });
});
