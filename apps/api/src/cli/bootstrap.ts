import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { z } from 'zod';
import { PrismaClient, ensurePlatformDefaults } from '@platform/database';
import type { PlatformDefaultsDb, PlatformDefaultsResult, Prisma } from '@platform/database';
import { normalizePhone } from '@platform/shared';

/**
 * Production bootstrap (docs/CICD_GUIDE.md "Preprod ortamı"). Ships in the
 * API image and runs against the database in DATABASE_URL:
 *
 *   node dist/cli/bootstrap.js --defaults-only
 *   node dist/cli/bootstrap.js --super-admin-phone +905551112233 \
 *     --super-admin-email owner@example.com --super-admin-name "Ad Soyad"
 *
 * 1. Platform defaults (packages/database/src/platform-defaults.ts): creates
 *    only what is missing, never updates or deletes, so it is safe on every
 *    deploy (deploy.sh runs `--defaults-only` after the migrations).
 * 2. First super admin (one-time, by hand): refuses when a different super
 *    admin already exists unless --allow-additional-super-admin is given,
 *    and never touches an existing user. The password comes from
 *    BOOTSTRAP_SUPER_ADMIN_PASSWORD or is generated and printed exactly
 *    once to stdout; it is never logged anywhere else.
 *
 * Never creates demo tenants, demo users or known passwords.
 */

/** Same cost factor as the auth service (apps/api/src/modules/auth). */
export const BCRYPT_ROUNDS = 10;
export const MIN_PASSWORD_LENGTH = 12;
/** Serialises concurrent bootstrap runs (two deploys, or a deploy and a manual run). */
const ADVISORY_LOCK_KEY = 815_420_031;

export class BootstrapUsageError extends Error {}
export class BootstrapRefusedError extends Error {}

export interface SuperAdminInput {
  phone: string;
  email: string;
  firstName: string;
  lastName: string;
  /** Null: generate one and print it once. */
  password: string | null;
}

export interface BootstrapOptions {
  help: boolean;
  superAdmin: SuperAdminInput | null;
  allowAdditionalSuperAdmin: boolean;
}

export const USAGE = [
  'Usage: node dist/cli/bootstrap.js [options]',
  '',
  '  --defaults-only                      Only create missing platform defaults (safe on every deploy).',
  '  --super-admin-phone <E.164>          First super admin phone, e.g. +905551112233 (env BOOTSTRAP_SUPER_ADMIN_PHONE).',
  '  --super-admin-email <email>          First super admin email (env BOOTSTRAP_SUPER_ADMIN_EMAIL).',
  '  --super-admin-name "<first last>"    First super admin full name (env BOOTSTRAP_SUPER_ADMIN_NAME).',
  '  --allow-additional-super-admin       Create the user even though another super admin exists.',
  '  --help                               Show this text.',
  '',
  'Password: BOOTSTRAP_SUPER_ADMIN_PASSWORD (at least 12 characters) if set, otherwise a random one',
  'is generated and printed once. Pass it with `docker compose run -e BOOTSTRAP_SUPER_ADMIN_PASSWORD ...`',
  'so it is read from your shell and never written to a file.',
].join('\n');

const FLAGS_WITH_VALUE = new Set(['--super-admin-phone', '--super-admin-email', '--super-admin-name']);
const BOOLEAN_FLAGS = new Set(['--defaults-only', '--allow-additional-super-admin', '--help']);

/** Splits "Ad Soyad" into first and last name; everything before the last word is the first name. */
export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) throw new BootstrapUsageError('Super admin name must contain a first and a last name');
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

export function parseBootstrapArgs(argv: readonly string[], env: Record<string, string | undefined>): BootstrapOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    const eq = raw.indexOf('=');
    const name = eq > 0 ? raw.slice(0, eq) : raw;
    if (BOOLEAN_FLAGS.has(name) && eq < 0) {
      flags.add(name);
    } else if (FLAGS_WITH_VALUE.has(name)) {
      const value = eq > 0 ? raw.slice(eq + 1) : argv[++i];
      if (value === undefined || value.startsWith('--')) throw new BootstrapUsageError(`${name} needs a value`);
      values.set(name, value);
    } else {
      throw new BootstrapUsageError(`Unknown argument: ${raw}`);
    }
  }

  const help = flags.has('--help');
  const allowAdditionalSuperAdmin = flags.has('--allow-additional-super-admin');
  if (help) return { help, superAdmin: null, allowAdditionalSuperAdmin };

  if (flags.has('--defaults-only')) {
    if (values.size > 0 || allowAdditionalSuperAdmin) throw new BootstrapUsageError('--defaults-only cannot be combined with super admin options');
    return { help, superAdmin: null, allowAdditionalSuperAdmin };
  }

  const phoneRaw = values.get('--super-admin-phone') ?? env.BOOTSTRAP_SUPER_ADMIN_PHONE;
  const emailRaw = values.get('--super-admin-email') ?? env.BOOTSTRAP_SUPER_ADMIN_EMAIL;
  const nameRaw = values.get('--super-admin-name') ?? env.BOOTSTRAP_SUPER_ADMIN_NAME;
  if (!phoneRaw || !emailRaw || !nameRaw) {
    throw new BootstrapUsageError('Give the super admin phone, email and name, or --defaults-only');
  }

  // E.164 only: the platform is global, so no country is assumed for a national number.
  const phone = phoneRaw.trim().startsWith('+') ? normalizePhone(phoneRaw.trim()) : null;
  if (!phone) throw new BootstrapUsageError('Super admin phone must be a valid number in E.164 form, e.g. +905551112233');
  const email = z.string().trim().toLowerCase().email().safeParse(emailRaw);
  if (!email.success) throw new BootstrapUsageError('Super admin email is not a valid address');
  const { firstName, lastName } = splitFullName(nameRaw);
  if (firstName.length > 60 || lastName.length > 60) throw new BootstrapUsageError('Super admin name is too long');

  const password = env.BOOTSTRAP_SUPER_ADMIN_PASSWORD ?? null;
  if (password !== null && password.length < MIN_PASSWORD_LENGTH) {
    throw new BootstrapUsageError(`BOOTSTRAP_SUPER_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  return { help, allowAdditionalSuperAdmin, superAdmin: { phone, email: email.data, firstName, lastName, password } };
}

/** 24 URL-safe characters (144 bits) from the OS CSPRNG. */
export function generatePassword(): string {
  return randomBytes(18).toString('base64url');
}

export type SuperAdminOutcome = { status: 'created'; userId: string } | { status: 'already-exists'; userId: string };

type SuperAdminDb = Pick<Prisma.TransactionClient, 'user'>;

/**
 * Creates the super admin inside the caller's transaction. Re-running with
 * the same phone is a no-op; a different existing super admin, or any
 * existing user with this phone or email, is a refusal (existing accounts
 * are never modified here).
 */
export async function ensureFirstSuperAdmin(
  db: SuperAdminDb,
  input: Omit<SuperAdminInput, 'password'> & { passwordHash: string },
  allowAdditionalSuperAdmin: boolean,
): Promise<SuperAdminOutcome> {
  const admins = await db.user.findMany({ where: { isSuperAdmin: true }, select: { id: true, phone: true } });
  const same = admins.find((a) => a.phone === input.phone);
  if (same) return { status: 'already-exists', userId: same.id };
  if (admins.length > 0 && !allowAdditionalSuperAdmin) {
    throw new BootstrapRefusedError(
      `A super admin already exists (${admins.length}). Nothing was changed. Pass --allow-additional-super-admin to add another one.`,
    );
  }

  const clash = await db.user.findFirst({ where: { OR: [{ phone: input.phone }, { email: input.email }] }, select: { id: true } });
  if (clash) {
    throw new BootstrapRefusedError('A user with this phone or email already exists and is not a super admin. Nothing was changed.');
  }

  const user = await db.user.create({
    data: {
      phone: input.phone,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      passwordHash: input.passwordHash,
      isSuperAdmin: true,
    },
    select: { id: true },
  });
  return { status: 'created', userId: user.id };
}

export interface BootstrapIo {
  out: (line: string) => void;
}

export interface BootstrapDeps {
  prisma: Pick<PrismaClient, '$transaction'>;
  ensureDefaults?: (db: PlatformDefaultsDb) => Promise<PlatformDefaultsResult>;
  hash?: (password: string) => Promise<string>;
  newPassword?: () => string;
}

export interface BootstrapResult {
  defaults: PlatformDefaultsResult;
  superAdmin: SuperAdminOutcome | null;
}

const TX_OPTIONS = { maxWait: 10_000, timeout: 120_000 } as const;

export async function runBootstrap(options: BootstrapOptions, deps: BootstrapDeps, io: BootstrapIo): Promise<BootstrapResult> {
  const ensureDefaults = deps.ensureDefaults ?? ensurePlatformDefaults;
  const hash = deps.hash ?? ((p: string) => bcrypt.hash(p, BCRYPT_ROUNDS));
  const newPassword = deps.newPassword ?? generatePassword;

  const defaults = await deps.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`;
    return ensureDefaults(tx);
  }, TX_OPTIONS);

  const createdTables = Object.entries(defaults.created).sort(([a], [b]) => a.localeCompare(b));
  if (createdTables.length === 0) {
    io.out('Platform defaults: already present, nothing created.');
  } else {
    io.out('Platform defaults created:');
    for (const [table, n] of createdTables) io.out(`  ${table}: ${n}`);
  }

  if (!options.superAdmin) return { defaults, superAdmin: null };

  const { password: givenPassword, ...identity } = options.superAdmin;
  const generated = givenPassword === null;
  const password = givenPassword ?? newPassword();
  const passwordHash = await hash(password);

  const superAdmin = await deps.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`;
    return ensureFirstSuperAdmin(tx, { ...identity, passwordHash }, options.allowAdditionalSuperAdmin);
  }, TX_OPTIONS);

  if (superAdmin.status === 'already-exists') {
    io.out(`Super admin ${identity.phone} already exists; nothing changed (its password was not touched).`);
    return { defaults, superAdmin };
  }

  io.out(`Super admin created: ${identity.firstName} ${identity.lastName} <${identity.email}> ${identity.phone}`);
  if (generated) {
    // The only place the password ever appears: this terminal, once.
    io.out('Generated password (shown once, store it in a password manager now):');
    io.out(`  ${password}`);
  } else {
    io.out('Password: taken from BOOTSTRAP_SUPER_ADMIN_PASSWORD (not printed).');
  }
  return { defaults, superAdmin };
}

async function main(): Promise<number> {
  let options: BootstrapOptions;
  try {
    options = parseBootstrapArgs(process.argv.slice(2), process.env);
  } catch (err) {
    if (err instanceof BootstrapUsageError) {
      process.stderr.write(`${err.message}\n\n${USAGE}\n`);
      return 2;
    }
    throw err;
  }
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const prisma = new PrismaClient({ log: ['error'] });
  try {
    await runBootstrap(options, { prisma }, { out: (line) => process.stdout.write(`${line}\n`) });
    return 0;
  } catch (err) {
    if (err instanceof BootstrapRefusedError) {
      process.stderr.write(`Refused: ${err.message}\n`);
      return 3;
    }
    // Never echo the options object: it may carry the password.
    process.stderr.write(`Bootstrap failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
