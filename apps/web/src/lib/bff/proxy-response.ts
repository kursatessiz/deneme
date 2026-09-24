import { stripHopByHopHeaders } from './headers';

/**
 * A non-JSON API response (CSV export, PDF download, ...) is passed through
 * byte-for-byte: the body is read as bytes and every non hop-by-hop header
 * (including `content-type` and `content-disposition`) is copied onto the
 * response the browser receives. This is what lets `GET /invoices/export`
 * or a report's `?format=csv` reach the browser as a real file download
 * (correct filename, correct MIME type) while the request still went
 * through the BFF's cookie-based auth instead of exposing a token.
 */
export function isJsonResponse(apiRes: Response): boolean {
  const contentType = apiRes.headers.get('content-type') ?? '';
  return contentType.includes('application/json');
}

export interface PassthroughResponseInit {
  status: number;
  headers: Headers;
}

/** Builds the status/headers for a passthrough (non-JSON) response; the caller reads `apiRes.arrayBuffer()` for the body. */
export function buildPassthroughResponseInit(apiRes: Response): PassthroughResponseInit {
  return { status: apiRes.status, headers: stripHopByHopHeaders(apiRes.headers) };
}
