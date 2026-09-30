import { request as httpsRequest } from 'https';
import { Injectable } from '@nestjs/common';
import { resolvePublicHttpsAddresses } from '../../webhooks/ssrf-check';

const TIMEOUT_MS = 5000;
/** The response body is read only to free the socket; this many bytes are kept at most (none is ever returned). */
const DRAIN_LIMIT_BYTES = 4096;

export class AlertHostNotAllowedError extends Error {
  constructor() {
    super('Alert destination host is not allowed');
    this.name = 'AlertHostNotAllowedError';
  }
}

export interface AlertHttpRequest {
  /** https URL. */
  url: string;
  body: string;
  headers: Record<string, string>;
  /** Fixed provider hosts (data in @platform/shared); omitted for the generic webhook, whose host is any public one. */
  allowedHosts?: readonly string[];
}

/**
 * The only way alert sinks reach the network, and the seam the e2e suite
 * replaces so no test calls a real service. Every request is https only, has
 * a 5 second timeout and never follows redirects. The destination is checked
 * against the sink's host allow-list when it has one, resolved and rejected if
 * any address is private, loopback, link-local or reserved (the webhooks
 * module's SSRF guard), and the connection is then pinned to the validated
 * address so a DNS answer cannot change between the check and the connect.
 */
@Injectable()
export class AlertHttpClient {
  async post(input: AlertHttpRequest): Promise<{ status: number }> {
    const target = new URL(input.url);
    if (input.allowedHosts && !input.allowedHosts.includes(target.hostname)) throw new AlertHostNotAllowedError();
    const addresses = await resolvePublicHttpsAddresses(input.url);
    const pinned = addresses[0];

    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || 443,
          path: `${target.pathname}${target.search}`,
          method: 'POST',
          headers: { ...input.headers, 'Content-Length': Buffer.byteLength(input.body) },
          timeout: TIMEOUT_MS,
          lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
        },
        (res) => {
          let read = 0;
          res.on('data', (chunk: Buffer) => {
            read += chunk.length;
            if (read > DRAIN_LIMIT_BYTES) res.destroy();
          });
          res.on('close', () => resolve({ status: res.statusCode ?? 0 }));
          res.on('error', () => resolve({ status: res.statusCode ?? 0 }));
        },
      );
      req.on('timeout', () => req.destroy(new Error('Timeout')));
      req.on('error', (err) => reject(err));
      req.write(input.body);
      req.end();
    });
  }
}
