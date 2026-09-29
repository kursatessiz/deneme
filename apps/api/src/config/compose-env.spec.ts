import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EnvSchema } from './env';

/**
 * D1 regression guard: every environment key the API (and the web app's
 * server side) reads must reach its production container. A key that is
 * neither passed by deploy/docker-compose.prod.yml nor listed below as
 * intentionally not passed fails this test, and every key compose takes from
 * /opt/app/.env must be documented in the root .env.example.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const COMPOSE = readFileSync(join(REPO_ROOT, 'deploy', 'docker-compose.prod.yml'), 'utf8');
const ENV_EXAMPLE = readFileSync(join(REPO_ROOT, '.env.example'), 'utf8');

/** Keys deliberately kept out of the production containers, with the reason. */
const API_INTENTIONALLY_NOT_PASSED: Record<string, string> = {
  OTP_TEST_CODE: 'test only; env validation rejects it outside NODE_ENV=test',
  AI_FAKE_PROVIDER: 'test only (web e2e); env validation refuses it in production',
  PATH: 'inherited from the image; read by the backup pg_dump child process',
};
const WEB_INTENTIONALLY_NOT_PASSED: Record<string, string> = {
  NEXT_PUBLIC_API_URL: 'build-time development fallback only; production reads PUBLIC_API_URL at runtime',
};

/** Values compose computes itself; they must never be a plain pass-through of the same .env key. */
const COMPOSE_COMPUTED = ['NODE_ENV', 'PORT', 'DATABASE_URL', 'REDIS_URL', 'CORS_ORIGIN', 'PUBLIC_APP_URL', 'PUBLIC_API_URL'];

/** `KEY: value` lines of one service's `environment:` mapping (2-space YAML, as the file is written). */
function serviceEnvironment(service: string): Map<string, string> {
  const lines = COMPOSE.split('\n');
  const start = lines.findIndex((l) => l === `  ${service}:`);
  if (start < 0) throw new Error(`service ${service} not found in docker-compose.prod.yml`);
  const env = new Map<string, string>();
  let inEnv = false;
  for (const line of lines.slice(start + 1)) {
    if (/^ {2}\S/.test(line) || /^\S/.test(line)) break; // next service or top-level key
    if (/^ {4}\S/.test(line)) {
      inEnv = line.trim() === 'environment:';
      continue;
    }
    const m = inEnv ? /^ {6}([A-Z][A-Z0-9_]*):\s*(.*)$/.exec(line) : null;
    if (m) env.set(m[1], m[2].trim());
  }
  return env;
}

/** `process.env.X` reads in non-test TypeScript sources under `dir`. */
function directEnvReads(dir: string): Set<string> {
  const keys = new Set<string>();
  const walk = (d: string) => {
    // withFileTypes: the directory entry already knows its kind, so no
    // separate stat call sits between the listing and the read.
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const name = entry.name;
      const p = join(d, name);
      if (entry.isDirectory()) {
        if (name !== 'node_modules') walk(p);
      } else if (entry.isFile() && /\.tsx?$/.test(name) && !/\.(spec|test|e2e)\.tsx?$/.test(name)) {
        for (const m of readFileSync(p, 'utf8').matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]*)|\[['"]([A-Z][A-Z0-9_]*)['"]\])/g)) {
          keys.add(m[1] ?? m[2]);
        }
      }
    }
  };
  walk(dir);
  return keys;
}

function uncovered(required: Iterable<string>, passed: Map<string, string>, notPassed: Record<string, string>): string[] {
  return [...new Set(required)].filter((k) => !passed.has(k) && !(k in notPassed)).sort();
}

describe('docker-compose.prod.yml environment (D1)', () => {
  const api = serviceEnvironment('api');
  const web = serviceEnvironment('web');

  it('passes every API env schema key and every direct process.env read, or lists it as intentionally not passed', () => {
    const schemaKeys = Object.keys(EnvSchema.innerType().shape);
    const missing = uncovered([...schemaKeys, ...directEnvReads(join(REPO_ROOT, 'apps', 'api', 'src'))], api, API_INTENTIONALLY_NOT_PASSED);
    // Add the key to the api service (`KEY: ${KEY:-}`) and to .env.example,
    // or to API_INTENTIONALLY_NOT_PASSED with the reason.
    expect(missing).toEqual([]);
  });

  it('passes every server-side env read of the web app, or lists it as intentionally not passed', () => {
    const missing = uncovered(directEnvReads(join(REPO_ROOT, 'apps', 'web', 'src')), web, WEB_INTENTIONALLY_NOT_PASSED);
    expect(missing).toEqual([]);
    expect(web.get('PUBLIC_API_URL')).toBe('https://${API_DOMAIN}');
  });

  it('never passes an intentionally excluded key', () => {
    expect(Object.keys(API_INTENTIONALLY_NOT_PASSED).filter((k) => api.has(k))).toEqual([]);
    expect(Object.keys(WEB_INTENTIONALLY_NOT_PASSED).filter((k) => web.has(k))).toEqual([]);
  });

  it('keeps compose-computed values authoritative', () => {
    for (const key of COMPOSE_COMPUTED) {
      expect(api.get(key)).toBeDefined();
      expect(api.get(key)).not.toMatch(new RegExp(`^\\$\\{${key}(:?-[^}]*)?\\}$`));
    }
  });

  it('documents every variable compose reads from /opt/app/.env in .env.example', () => {
    const referenced = new Set([...COMPOSE.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]));
    // Set by lib.sh use_release() for each deploy, not by the operator.
    for (const key of ['RELEASE_TAG', 'API_IMAGE', 'WEB_IMAGE']) referenced.delete(key);
    const documented = (key: string) => new RegExp(`^#?\\s*${key}=`, 'm').test(ENV_EXAMPLE);
    expect([...referenced].filter((k) => !documented(k)).sort()).toEqual([]);
  });
});
