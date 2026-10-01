import { ConfigService } from '@nestjs/config';
import { SiteCacheService } from './site-cache.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('SiteCacheService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  const make = (env: Record<string, string | undefined>, slug: string | null = 'zen') => {
    const prisma = { studio: { findUnique: jest.fn(async () => (slug ? { slug } : null)) } } as unknown as PrismaService;
    const config = { get: (key: string) => env[key] } as unknown as ConfigService;
    return new SiteCacheService(prisma, config);
  };

  it('posts the site tag with the shared secret', async () => {
    const fn = jest.fn(async () => new Response('{}', { status: 200 }));
    global.fetch = fn as unknown as typeof fetch;
    await make({ WEB_INTERNAL_URL: 'http://web:3000/', REVALIDATE_SECRET: 'a'.repeat(20) }).purgeStudio('studio-id');
    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://web:3000/api/revalidate');
    expect((init.headers as Record<string, string>)['x-revalidate-secret']).toBe('a'.repeat(20));
    expect(JSON.parse(init.body as string)).toEqual({ tags: ['site:zen'] });
  });

  it('does nothing without a configured web url and secret', async () => {
    const fn = jest.fn();
    global.fetch = fn as unknown as typeof fetch;
    await make({}).purgeStudio('studio-id');
    await make({ WEB_INTERNAL_URL: 'http://web:3000' }).purgeStudio('studio-id');
    expect(fn).not.toHaveBeenCalled();
  });

  it('never throws when the web app is down or the studio is unknown', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;
    const env = { WEB_INTERNAL_URL: 'http://web:3000', REVALIDATE_SECRET: 'a'.repeat(20) };
    await expect(make(env).purgeStudio('studio-id')).resolves.toBeUndefined();
    await expect(make(env, null).purgeStudio('missing')).resolves.toBeUndefined();
  });
});
