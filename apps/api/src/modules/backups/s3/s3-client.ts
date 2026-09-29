import { Readable } from 'stream';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import { EMPTY_PAYLOAD_SHA256, canonicalQuery, encodeKeyPath, presignUrl, sha256Hex, signRequest } from './sigv4';
import type { SigV4Credentials } from './sigv4';

export interface S3ClientConfig {
  /** e.g. https://s3.eu-central-1.amazonaws.com or https://<account>.r2.cloudflarestorage.com */
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface S3Object {
  key: string;
  size: number;
  lastModified: Date;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** HTTP status and the S3 error code only: messages never carry credentials or signed URLs. */
export class S3Error extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`S3 ${operation} failed: HTTP ${status}${code ? ` ${code}` : ''}`);
    this.name = 'S3Error';
  }
}

const REQUEST_TIMEOUT_MS = 60_000;
/** Whole-body limit for streamed downloads (a large dump over a slow link). */
const STREAM_TIMEOUT_MS = 60 * 60_000;

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? decodeXml(m[1]) : null;
}

/** Parses one ListObjectsV2 result page. Exported for the spec. */
export function parseListObjectsV2(xml: string): { objects: S3Object[]; isTruncated: boolean; nextToken: string | null } {
  const objects: S3Object[] = [];
  const re = /<Contents>([\s\S]*?)<\/Contents>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const body = m[1];
    const key = tag(body, 'Key');
    const size = tag(body, 'Size');
    const lastModified = tag(body, 'LastModified');
    if (key === null || size === null || lastModified === null) continue;
    objects.push({ key, size: Number(size), lastModified: new Date(lastModified) });
  }
  return { objects, isTruncated: tag(xml, 'IsTruncated') === 'true', nextToken: tag(xml, 'NextContinuationToken') };
}

/**
 * Minimal path-style S3 client (the same addressing deploy/scripts/backup.sh
 * uses with curl): list, head, get, put, delete, multipart upload and
 * presigned GET. Works with AWS S3, Cloudflare R2, Backblaze B2, Wasabi and
 * MinIO.
 */
export class S3Client {
  private readonly base: URL;
  private readonly creds: SigV4Credentials;

  constructor(
    private readonly config: S3ClientConfig,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.base = new URL(config.endpoint.replace(/\/+$/, ''));
    this.creds = { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, region: config.region };
  }

  get endpointHost(): string {
    return this.base.host;
  }

  private path(key?: string): string {
    const basePath = this.base.pathname.replace(/\/+$/, '');
    return `${basePath}/${encodeKeyPath(this.config.bucket)}${key !== undefined ? `/${encodeKeyPath(key)}` : ''}`;
  }

  private async send(
    operation: string,
    method: string,
    key: string | undefined,
    opts: { query?: Record<string, string>; body?: Buffer; headers?: Record<string, string>; stream?: boolean; okStatuses?: number[] } = {},
  ): Promise<Response> {
    const path = this.path(key);
    const payloadHash = opts.body ? sha256Hex(opts.body) : EMPTY_PAYLOAD_SHA256;
    const headers = signRequest(
      { method, host: this.base.host, path, query: opts.query, headers: opts.headers, payloadHash },
      this.creds,
      this.clock(),
    );
    const qs = opts.query && Object.keys(opts.query).length > 0 ? `?${canonicalQuery(opts.query)}` : '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.stream ? STREAM_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
    timer.unref?.();
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base.protocol}//${this.base.host}${path}${qs}`, {
        method,
        headers,
        body: opts.body ? new Uint8Array(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new S3Error(operation, 0, err instanceof Error ? err.name : null);
    }
    if (!opts.stream) clearTimeout(timer);
    const ok = opts.okStatuses ?? [200];
    if (!ok.includes(res.status)) {
      clearTimeout(timer);
      const text = method === 'HEAD' ? '' : await res.text().catch(() => '');
      throw new S3Error(operation, res.status, tag(text, 'Code'));
    }
    return res;
  }

  async list(prefix: string): Promise<S3Object[]> {
    const all: S3Object[] = [];
    let token: string | null = null;
    for (let page = 0; page < 100; page++) {
      const query: Record<string, string> = { 'list-type': '2', prefix };
      if (token) query['continuation-token'] = token;
      const res = await this.send('ListObjectsV2', 'GET', undefined, { query });
      const parsed = parseListObjectsV2(await res.text());
      all.push(...parsed.objects);
      if (!parsed.isTruncated || !parsed.nextToken) break;
      token = parsed.nextToken;
    }
    return all;
  }

  /** Null when the object does not exist. */
  async head(key: string): Promise<{ size: number; lastModified: Date | null } | null> {
    try {
      const res = await this.send('HeadObject', 'HEAD', key);
      const lm = res.headers.get('last-modified');
      return { size: Number(res.headers.get('content-length') ?? '0'), lastModified: lm ? new Date(lm) : null };
    } catch (err) {
      if (err instanceof S3Error && err.status === 404) return null;
      throw err;
    }
  }

  async getText(key: string): Promise<string | null> {
    try {
      const res = await this.send('GetObject', 'GET', key);
      return await res.text();
    } catch (err) {
      if (err instanceof S3Error && err.status === 404) return null;
      throw err;
    }
  }

  async getStream(key: string): Promise<Readable> {
    const res = await this.send('GetObject', 'GET', key, { stream: true });
    if (!res.body) throw new S3Error('GetObject', res.status, 'EmptyBody');
    return Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>);
  }

  async put(key: string, body: Buffer, contentType = 'application/octet-stream'): Promise<void> {
    await this.send('PutObject', 'PUT', key, { body, headers: { 'content-type': contentType } });
  }

  async delete(key: string): Promise<void> {
    await this.send('DeleteObject', 'DELETE', key, { okStatuses: [200, 204] });
  }

  async createMultipartUpload(key: string, contentType = 'application/octet-stream'): Promise<string> {
    const res = await this.send('CreateMultipartUpload', 'POST', key, { query: { uploads: '' }, headers: { 'content-type': contentType } });
    const uploadId = tag(await res.text(), 'UploadId');
    if (!uploadId) throw new S3Error('CreateMultipartUpload', res.status, 'MissingUploadId');
    return uploadId;
  }

  async uploadPart(key: string, uploadId: string, partNumber: number, body: Buffer): Promise<string> {
    const res = await this.send('UploadPart', 'PUT', key, { query: { partNumber: String(partNumber), uploadId }, body });
    const etag = res.headers.get('etag');
    if (!etag) throw new S3Error('UploadPart', res.status, 'MissingETag');
    return etag;
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>): Promise<void> {
    const xml =
      '<CompleteMultipartUpload>' +
      parts.map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</ETag></Part>`).join('') +
      '</CompleteMultipartUpload>';
    const res = await this.send('CompleteMultipartUpload', 'POST', key, {
      query: { uploadId },
      body: Buffer.from(xml, 'utf8'),
      headers: { 'content-type': 'application/xml' },
    });
    // S3 can answer 200 with an <Error> body when the completion failed late.
    const text = await res.text();
    if (/<Error>/.test(text)) throw new S3Error('CompleteMultipartUpload', 200, tag(text, 'Code'));
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.send('AbortMultipartUpload', 'DELETE', key, { query: { uploadId }, okStatuses: [200, 204, 404] });
  }

  presignGet(key: string, expiresSeconds: number): string {
    const protocol = this.base.protocol === 'http:' ? 'http:' : 'https:';
    return presignUrl({ method: 'GET', host: this.base.host, path: this.path(key), protocol }, this.creds, this.clock(), expiresSeconds);
  }
}
