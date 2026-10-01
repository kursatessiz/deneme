import { IndexNowSubmitter } from './indexnow-submitter.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AlertHttpClient } from '../../error-reporting/alert-sinks/alert-http.client';
import type { IndexNowKeyService } from './indexnow-key.service';

const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('IndexNowSubmitter', () => {
  const realEnv = process.env.NODE_ENV;
  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = realEnv;
  });

  function make(options: { flagOn?: boolean; status?: number; key?: string | null } = {}) {
    const flagRows = options.flagOn === false ? [] : [{ enabled: true }];
    const prisma = {
      studio: {
        // The flag resolver and the submitter both read the studio.
        findUnique: jest.fn(async () => ({ slug: 'zen', isPlatform: false, businessTypeTemplateId: null, site: { primaryDomain: null, domains: [] } })),
      },
      featureFlag: { findFirst: jest.fn(async (args: { where: { scope: string } }) => (args.where.scope === 'TENANT' ? (flagRows[0] ?? null) : null)) },
      studioAddOn: { findMany: jest.fn(async () => []) },
      auditLog: { create: jest.fn(async () => ({})) },
    } as unknown as PrismaService;
    const http = { post: jest.fn(async () => ({ status: options.status ?? 200 })) } as unknown as AlertHttpClient;
    const keys = { ensureKey: jest.fn(async () => (options.key === undefined ? KEY : options.key)) } as unknown as IndexNowKeyService;
    return { submitter: new IndexNowSubmitter(prisma, http, keys), prisma, http };
  }

  const job = { studioId: 'studio-1', urls: ['https://zen.localhost/tr', 'https://zen.localhost/en/pricing'] };

  it('never calls out in the test environment', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    const { submitter, http } = make();
    expect(await submitter.submit(job)).toBe('skipped_test');
    expect(http.post).not.toHaveBeenCalled();
  });

  it('skips a job whose flag was turned off while it waited', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    const { submitter, http } = make({ flagOn: false });
    expect(await submitter.submit(job)).toBe('skipped_flag_off');
    expect(http.post).not.toHaveBeenCalled();
  });

  it('posts the payload to api.indexnow.org through the egress client and logs it', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    const { submitter, http, prisma } = make();
    expect(await submitter.submit(job)).toBe('sent');
    const call = (http.post as jest.Mock).mock.calls[0][0] as { url: string; body: string; allowedHosts: string[] };
    expect(call.url).toBe('https://api.indexnow.org/indexnow');
    expect(call.allowedHosts).toEqual(['api.indexnow.org']);
    const body = JSON.parse(call.body) as { host: string; key: string; keyLocation: string; urlList: string[] };
    expect(body.key).toBe(KEY);
    expect(body.keyLocation).toBe(`https://${body.host}/${KEY}.txt`);
    expect(body.urlList.every((u) => u.startsWith(`https://${body.host}/`))).toBe(true);
    expect((prisma.auditLog.create as jest.Mock).mock.calls[0][0].data).toMatchObject({ studioId: 'studio-1', action: 'indexnow.submitted', metadata: { status: 200 } });
  });

  it('retries on a rate limit but not on a refusal', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    await expect(make({ status: 429 }).submitter.submit(job)).rejects.toThrow('429');
    expect(await make({ status: 403 }).submitter.submit(job)).toBe('rejected');
  });

  it('submits nothing when the site has no key or the URLs are not of its host', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    const { submitter, http } = make({ key: null });
    expect(await submitter.submit(job)).toBe('skipped_no_payload');
    expect(await make().submitter.submit({ studioId: 'studio-1', urls: ['https://other.example.com/tr'] })).toBe('skipped_no_payload');
    expect(http.post).not.toHaveBeenCalled();
  });
});
