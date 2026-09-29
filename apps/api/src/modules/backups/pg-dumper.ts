import { spawn } from 'child_process';
import type { Readable } from 'stream';

/** Injection token; e2e tests replace the real pg_dump with a fixed SQL stream. */
export const DATABASE_DUMPER = Symbol('DATABASE_DUMPER');

export interface DumpHandle {
  /** Plain SQL, exactly what `pg_dump -U <user> -d <db>` writes (the host script's format). */
  stdout: Readable;
  /** Resolves when pg_dump exits 0; rejects with a message that never contains the password. */
  done: Promise<void>;
  /** Stops the dump early (the upload failed). */
  kill(): void;
}

export interface DatabaseDumper {
  dump(): DumpHandle;
}

/**
 * libpq connection environment from DATABASE_URL. pg_dump does not accept
 * Prisma's `?schema=` parameter, so the URL is taken apart; the password
 * goes through PGPASSWORD, never the command line.
 */
export function pgEnvFromUrl(databaseUrl: string): Record<string, string> {
  const url = new URL(databaseUrl);
  const env: Record<string, string> = {
    PGHOST: decodeURIComponent(url.hostname),
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')),
  };
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

const STDERR_LIMIT = 2000;

export class PgDumpDumper implements DatabaseDumper {
  constructor(
    private readonly databaseUrl: string,
    private readonly binary = 'pg_dump',
  ) {}

  dump(): DumpHandle {
    const pgEnv = pgEnvFromUrl(this.databaseUrl);
    const child = spawn(this.binary, [], {
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...pgEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < STDERR_LIMIT) stderr += d.toString('utf8');
    });
    const done = new Promise<void>((resolve, reject) => {
      child.on('error', (err) => reject(new Error(`pg_dump could not start: ${err.message}`)));
      child.on('close', (code, signal) => {
        if (code === 0) resolve();
        else {
          const masked = pgEnv.PGPASSWORD ? stderr.split(pgEnv.PGPASSWORD).join('***') : stderr;
          const detail = masked.trim().slice(0, 500);
          reject(new Error(`pg_dump exited with ${code ?? signal}${detail ? `: ${detail}` : ''}`));
        }
      });
    });
    return { stdout: child.stdout, done, kill: () => child.kill('SIGTERM') };
  }
}
