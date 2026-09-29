import {
  PUBLIC_API_URL_META,
  apiOrigin,
  normalizeApiBaseUrl,
  publicApiBaseUrl,
  publicApiUrlFromDocument,
  serverPublicApiUrl,
} from './public-api-url';

function docWithMeta(content: string | null): Pick<Document, 'querySelector'> {
  return {
    querySelector: ((selector: string) =>
      selector === `meta[name="${PUBLIC_API_URL_META}"]` && content !== null ? { getAttribute: () => content } : null) as Document['querySelector'],
  };
}

describe('normalizeApiBaseUrl', () => {
  it('keeps http(s) base URLs and strips the trailing slash', () => {
    expect(normalizeApiBaseUrl('https://api.preprod.example.com/')).toBe('https://api.preprod.example.com');
    expect(normalizeApiBaseUrl(' http://localhost:4000 ')).toBe('http://localhost:4000');
    expect(normalizeApiBaseUrl('https://example.com/api/')).toBe('https://example.com/api');
  });

  it('rejects empty, relative, non-http, credentialed and query-carrying values', () => {
    for (const bad of [undefined, null, '', '/api', 'javascript:alert(1)', 'ftp://x.example.com', 'https://u:p@x.example.com', 'https://x.example.com/?a=1']) {
      expect(normalizeApiBaseUrl(bad)).toBeNull();
    }
  });
});

describe('serverPublicApiUrl', () => {
  it('prefers the runtime PUBLIC_API_URL over the build-time development fallback', () => {
    expect(serverPublicApiUrl({ PUBLIC_API_URL: 'https://api.example.com', NEXT_PUBLIC_API_URL: 'http://localhost:9999' })).toBe('https://api.example.com');
  });

  it('falls back to NEXT_PUBLIC_API_URL, then localhost, when unset or invalid', () => {
    expect(serverPublicApiUrl({ PUBLIC_API_URL: '', NEXT_PUBLIC_API_URL: 'http://localhost:9999/' })).toBe('http://localhost:9999');
    expect(serverPublicApiUrl({ PUBLIC_API_URL: 'not a url' })).toBe('http://localhost:4000');
    expect(serverPublicApiUrl({})).toBe('http://localhost:4000');
  });

  it('reads process.env at call time, not at module load', () => {
    const previous = process.env.PUBLIC_API_URL;
    process.env.PUBLIC_API_URL = 'https://api.preprod.example.com';
    try {
      expect(serverPublicApiUrl()).toBe('https://api.preprod.example.com');
      expect(publicApiBaseUrl()).toBe('https://api.preprod.example.com');
    } finally {
      if (previous === undefined) delete process.env.PUBLIC_API_URL;
      else process.env.PUBLIC_API_URL = previous;
    }
  });
});

describe('browser side', () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it('reads the server-rendered meta tag', () => {
    expect(publicApiUrlFromDocument(docWithMeta('https://api.example.com/'))).toBe('https://api.example.com');
    expect(publicApiUrlFromDocument(docWithMeta('javascript:alert(1)'))).toBeNull();
    expect(publicApiUrlFromDocument(docWithMeta(null))).toBeNull();
  });

  it('publicApiBaseUrl uses the meta tag in the browser and ignores the server env there', () => {
    (globalThis as unknown as { document: unknown }).document = docWithMeta('https://api.prod.example.com');
    const previous = process.env.PUBLIC_API_URL;
    process.env.PUBLIC_API_URL = 'https://should-not-be-used.example.com';
    try {
      expect(publicApiBaseUrl()).toBe('https://api.prod.example.com');
    } finally {
      if (previous === undefined) delete process.env.PUBLIC_API_URL;
      else process.env.PUBLIC_API_URL = previous;
    }
  });

  it('falls back to the development default when the tag is missing', () => {
    (globalThis as unknown as { document: unknown }).document = docWithMeta(null);
    expect(publicApiBaseUrl()).toBe(normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_URL) ?? 'http://localhost:4000');
  });
});

describe('apiOrigin', () => {
  it('drops the path for CSP source lists', () => {
    expect(apiOrigin('https://example.com/api')).toBe('https://example.com');
    expect(apiOrigin('http://localhost:4000')).toBe('http://localhost:4000');
  });
});
