import * as bcrypt from 'bcrypt';
import type { PlatformDefaultsResult } from '@platform/database';
import {
  BootstrapRefusedError,
  BootstrapUsageError,
  ensureFirstSuperAdmin,
  generatePassword,
  parseBootstrapArgs,
  runBootstrap,
  splitFullName,
} from './bootstrap';
import type { BootstrapOptions } from './bootstrap';

const IDENTITY = ['--super-admin-phone', '+905551112233', '--super-admin-email', 'Owner@Example.com', '--super-admin-name', 'Ayse Nur Demir'];

describe('parseBootstrapArgs', () => {
  it('parses flags and normalises the identity', () => {
    const opts = parseBootstrapArgs(IDENTITY, {});
    expect(opts.superAdmin).toEqual({
      phone: '+905551112233',
      email: 'owner@example.com',
      firstName: 'Ayse Nur',
      lastName: 'Demir',
      password: null,
    });
    expect(opts.allowAdditionalSuperAdmin).toBe(false);
  });

  it('accepts --flag=value and falls back to the BOOTSTRAP_SUPER_ADMIN_* env vars', () => {
    const opts = parseBootstrapArgs(['--super-admin-phone=+442079460958'], {
      BOOTSTRAP_SUPER_ADMIN_EMAIL: 'ops@example.com',
      BOOTSTRAP_SUPER_ADMIN_NAME: 'Sam Lee',
      BOOTSTRAP_SUPER_ADMIN_PASSWORD: 'correct-horse-battery',
    });
    expect(opts.superAdmin).toMatchObject({ phone: '+442079460958', email: 'ops@example.com', password: 'correct-horse-battery' });
  });

  it('supports --defaults-only and refuses to mix it with super admin options', () => {
    expect(parseBootstrapArgs(['--defaults-only'], { BOOTSTRAP_SUPER_ADMIN_PHONE: '+905551112233' }).superAdmin).toBeNull();
    expect(() => parseBootstrapArgs(['--defaults-only', ...IDENTITY], {})).toThrow(BootstrapUsageError);
  });

  it('rejects missing identity, national phone numbers, bad emails, short passwords and unknown flags', () => {
    expect(() => parseBootstrapArgs([], {})).toThrow(BootstrapUsageError);
    expect(() => parseBootstrapArgs(['--super-admin-phone', '05551112233', ...IDENTITY.slice(2)], {})).toThrow(/E\.164/);
    expect(() => parseBootstrapArgs([...IDENTITY.slice(0, 2), '--super-admin-email', 'nope', ...IDENTITY.slice(4)], {})).toThrow(/email/);
    expect(() => parseBootstrapArgs(IDENTITY, { BOOTSTRAP_SUPER_ADMIN_PASSWORD: 'short' })).toThrow(/12 characters/);
    expect(() => parseBootstrapArgs(['--password', 'x'], {})).toThrow(/Unknown argument/);
    expect(() => parseBootstrapArgs(['--super-admin-phone'], {})).toThrow(/needs a value/);
  });

  it('needs a first and a last name', () => {
    expect(splitFullName('  Ada   Lovelace ')).toEqual({ firstName: 'Ada', lastName: 'Lovelace' });
    expect(() => splitFullName('Madonna')).toThrow(BootstrapUsageError);
  });
});

describe('generatePassword', () => {
  it('returns distinct 24-character URL-safe values', () => {
    const a = generatePassword();
    const b = generatePassword();
    expect(a).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(a).not.toBe(b);
  });
});

/** Minimal in-memory stand-in for the parts of Prisma the super admin step uses. */
function fakeUsers(initial: { id: string; phone: string; email: string | null; isSuperAdmin: boolean }[] = []) {
  const rows = [...initial];
  const created: Record<string, unknown>[] = [];
  const user = {
    findMany: jest.fn(async ({ where }: { where: { isSuperAdmin: boolean } }) => rows.filter((r) => r.isSuperAdmin === where.isSuperAdmin)),
    findFirst: jest.fn(async ({ where }: { where: { OR: ({ phone: string } | { email: string })[] } }) =>
      rows.find((r) => where.OR.some((c) => ('phone' in c ? r.phone === c.phone : r.email === c.email))) ?? null,
    ),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `u${rows.length + 1}`, phone: data.phone as string, email: data.email as string, isSuperAdmin: data.isSuperAdmin as boolean };
      rows.push(row);
      created.push(data);
      return { id: row.id };
    }),
  };
  return { user, rows, created };
}

const INPUT = { phone: '+905551112233', email: 'owner@example.com', firstName: 'Ayse', lastName: 'Demir', passwordHash: 'hash' };

describe('ensureFirstSuperAdmin', () => {
  it('creates the first super admin with only the hash stored', async () => {
    const db = fakeUsers();
    const outcome = await ensureFirstSuperAdmin(db as never, INPUT, false);
    expect(outcome.status).toBe('created');
    expect(db.created).toEqual([{ ...INPUT, isSuperAdmin: true }]);
  });

  it('is a no-op when the same super admin already exists', async () => {
    const db = fakeUsers([{ id: 'u1', phone: INPUT.phone, email: INPUT.email, isSuperAdmin: true }]);
    expect(await ensureFirstSuperAdmin(db as never, INPUT, false)).toEqual({ status: 'already-exists', userId: 'u1' });
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('refuses when a different super admin exists unless explicitly allowed', async () => {
    const db = fakeUsers([{ id: 'u1', phone: '+905550000000', email: null, isSuperAdmin: true }]);
    await expect(ensureFirstSuperAdmin(db as never, INPUT, false)).rejects.toBeInstanceOf(BootstrapRefusedError);
    expect(db.user.create).not.toHaveBeenCalled();
    expect((await ensureFirstSuperAdmin(db as never, INPUT, true)).status).toBe('created');
  });

  it('never takes over an existing non-admin account', async () => {
    const db = fakeUsers([{ id: 'u1', phone: '+905559999999', email: INPUT.email, isSuperAdmin: false }]);
    await expect(ensureFirstSuperAdmin(db as never, INPUT, true)).rejects.toThrow(/already exists/);
    expect(db.user.create).not.toHaveBeenCalled();
  });
});

describe('runBootstrap', () => {
  const defaultsResult = (created: Record<string, number>): PlatformDefaultsResult => ({
    platformStudioId: 's1',
    platformSiteId: 'site1',
    businessTypeTemplateIds: {},
    planIds: {},
    documentIds: {},
    created,
  });

  function setup(existing: Parameters<typeof fakeUsers>[0] = []) {
    const users = fakeUsers(existing);
    const tx = { ...users, $executeRaw: jest.fn(async () => 0) };
    const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
    const lines: string[] = [];
    return { users, tx, prisma, lines, io: { out: (l: string) => lines.push(l) } };
  }

  const withAdmin = (password: string | null): BootstrapOptions => ({
    help: false,
    allowAdditionalSuperAdmin: false,
    superAdmin: { phone: INPUT.phone, email: INPUT.email, firstName: 'Ayse', lastName: 'Demir', password },
  });

  it('--defaults-only runs the defaults under the advisory lock and creates no user', async () => {
    const { prisma, tx, users, lines, io } = setup();
    const ensureDefaults = jest.fn(async () => defaultsResult({ plans: 2 }));
    const res = await runBootstrap({ help: false, allowAdditionalSuperAdmin: false, superAdmin: null }, { prisma: prisma as never, ensureDefaults }, io);
    expect(res.superAdmin).toBeNull();
    expect(ensureDefaults).toHaveBeenCalledWith(tx);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(users.user.create).not.toHaveBeenCalled();
    expect(lines).toContain('  plans: 2');
  });

  it('prints a generated password exactly once and stores only its bcrypt hash', async () => {
    const { prisma, users, lines, io } = setup();
    const res = await runBootstrap(withAdmin(null), { prisma: prisma as never, ensureDefaults: async () => defaultsResult({}), newPassword: () => 'generated-password-123456' }, io);
    expect(res.superAdmin?.status).toBe('created');
    expect(lines.filter((l) => l.includes('generated-password-123456'))).toHaveLength(1);
    const stored = users.created[0].passwordHash as string;
    expect(stored).not.toContain('generated-password-123456');
    expect(await bcrypt.compare('generated-password-123456', stored)).toBe(true);
    expect(lines).toContain('Platform defaults: already present, nothing created.');
  });

  it('never prints a password given through the environment', async () => {
    const { prisma, lines, io } = setup();
    await runBootstrap(withAdmin('from-the-environment-42'), { prisma: prisma as never, ensureDefaults: async () => defaultsResult({}), hash: async () => 'h' }, io);
    expect(lines.join('\n')).not.toContain('from-the-environment-42');
  });

  it('is idempotent: a second run with the same identity changes nothing', async () => {
    const { prisma, users, io } = setup();
    const deps = { prisma: prisma as never, ensureDefaults: async () => defaultsResult({}), hash: async () => 'h' };
    await runBootstrap(withAdmin('from-the-environment-42'), deps, io);
    const second = await runBootstrap(withAdmin('another-password-4242'), deps, io);
    expect(second.superAdmin?.status).toBe('already-exists');
    expect(users.user.create).toHaveBeenCalledTimes(1);
  });
});
