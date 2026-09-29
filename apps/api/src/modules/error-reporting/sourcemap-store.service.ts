import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import type { FileHandle } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { SOURCEMAP_LIMITS, SOURCEMAP_PLATFORMS, isValidSourcemapRelease } from '@platform/shared';
import type { SourcemapPlatform, SourcemapUploadResult } from '@platform/shared';
import { parseSourceMap } from './sourcemap-decoder';
import type { RawSourceMap } from './sourcemap-decoder';

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_ENTRIES = 6;

function fileKey(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 32);
}

export class SourcemapStoreError extends Error {
  constructor(
    readonly code: 'INVALID_MAP' | 'TOO_MANY_FILES',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Source maps on local disk (docs/HATA_RAPORLAMA.md, H2):
 * <SOURCEMAP_DIR>/<platform>/<release>/<sha256(path)>.map, whose first line
 * is the bundle path and the rest the map JSON. Retention is by file age
 * (30 days; the error heartbeat calls purgeExpired). Release and platform
 * are validated before they touch a path, and file names are hashes, so no
 * request value can escape the directory. A few parsed maps are cached.
 */
@Injectable()
export class SourcemapStoreService {
  private readonly logger = new Logger(SourcemapStoreService.name);
  private readonly dir: string;
  private readonly cache = new Map<string, { mtimeMs: number; map: RawSourceMap }>();

  constructor(config: ConfigService) {
    this.dir = config.get<string>('SOURCEMAP_DIR') ?? join(tmpdir(), 'platform-sourcemaps');
  }

  private releaseDir(platform: SourcemapPlatform, release: string): string {
    if (!SOURCEMAP_PLATFORMS.includes(platform) || !isValidSourcemapRelease(release)) throw new Error('Invalid sourcemap location');
    return join(this.dir, platform, release);
  }

  /** Validates and stores one map; replaces an existing map of the same path. */
  async save(input: { platform: SourcemapPlatform; release: string; path: string; mapText: string }): Promise<SourcemapUploadResult> {
    const bytes = Buffer.byteLength(input.mapText);
    if (bytes > SOURCEMAP_LIMITS.fileBytes) throw new SourcemapStoreError('INVALID_MAP', 'Source map too large');
    if (!parseSourceMap(input.mapText)) throw new SourcemapStoreError('INVALID_MAP', 'Not a source map v3 file');
    const dir = this.releaseDir(input.platform, input.release);
    await fs.mkdir(dir, { recursive: true });
    const name = `${fileKey(input.path)}.map`;
    const target = join(dir, name);
    const replaced = await fs.stat(target).then(
      () => true,
      () => false,
    );
    if (!replaced) {
      const existing = (await fs.readdir(dir)).filter((f) => f.endsWith('.map')).length;
      if (existing >= SOURCEMAP_LIMITS.filesPerRelease) throw new SourcemapStoreError('TOO_MANY_FILES', 'Too many source maps for this release');
    }
    const temp = join(dir, `.tmp-${randomBytes(6).toString('hex')}`);
    await fs.writeFile(temp, `${input.path}\n${input.mapText}`, { mode: 0o600 });
    await fs.rename(temp, target);
    this.cache.delete(target);
    return { release: input.release, platform: input.platform, path: input.path, bytes, replaced };
  }

  /** The first stored map among the candidate paths (longest first), parsed; null when none. */
  async find(platform: SourcemapPlatform, release: string, candidates: readonly string[]): Promise<RawSourceMap | null> {
    if (!isValidSourcemapRelease(release) || !SOURCEMAP_PLATFORMS.includes(platform)) return null;
    const dir = this.releaseDir(platform, release);
    for (const candidate of candidates) {
      const file = join(dir, `${fileKey(candidate)}.map`);
      // One handle for stat and read, so the file cannot be swapped between the two.
      let handle: FileHandle;
      try {
        handle = await fs.open(file, 'r');
      } catch {
        continue;
      }
      let mtimeMs: number;
      let content: string;
      try {
        mtimeMs = (await handle.stat()).mtimeMs;
        const cached = this.cache.get(file);
        if (cached && cached.mtimeMs === mtimeMs) {
          this.cache.delete(file);
          this.cache.set(file, cached);
          return cached.map;
        }
        content = await handle.readFile('utf8');
      } finally {
        await handle.close();
      }
      const newline = content.indexOf('\n');
      // The stored path must be the candidate itself (a hash collision would otherwise resolve a wrong file).
      if (newline === -1 || content.slice(0, newline) !== candidate) continue;
      const map = parseSourceMap(content.slice(newline + 1));
      if (!map) continue;
      this.cache.set(file, { mtimeMs, map });
      while (this.cache.size > CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value as string);
      return map;
    }
    return null;
  }

  /** Deletes maps older than the retention window and empty release folders. Returns the number of maps deleted. */
  async purgeExpired(now: Date): Promise<number> {
    const cutoff = now.getTime() - SOURCEMAP_LIMITS.retentionDays * DAY_MS;
    let deleted = 0;
    for (const platform of SOURCEMAP_PLATFORMS) {
      let releases: string[];
      try {
        releases = await fs.readdir(join(this.dir, platform));
      } catch {
        continue;
      }
      for (const release of releases) {
        if (!isValidSourcemapRelease(release)) continue;
        const dir = join(this.dir, platform, release);
        try {
          for (const file of await fs.readdir(dir)) {
            const path = join(dir, file);
            const stat = await fs.stat(path);
            if (stat.isFile() && stat.mtimeMs < cutoff) {
              await fs.unlink(path);
              this.cache.delete(path);
              if (file.endsWith('.map')) deleted++;
            }
          }
          if ((await fs.readdir(dir)).length === 0) await fs.rmdir(dir);
        } catch (err) {
          this.logger.warn(`Source map purge skipped ${platform}/${release}: ${err instanceof Error ? err.name : 'unknown'}`);
        }
      }
    }
    return deleted;
  }
}
