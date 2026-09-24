import { buildPassthroughResponseInit, isJsonResponse } from './proxy-response';

describe('isJsonResponse', () => {
  it('is true for application/json content types', () => {
    const res = new Response('{}', { headers: { 'content-type': 'application/json; charset=utf-8' } });
    expect(isJsonResponse(res)).toBe(true);
  });

  it('is false for a CSV export', () => {
    const res = new Response('a;b\r\n', { headers: { 'content-type': 'text/csv; charset=utf-8' } });
    expect(isJsonResponse(res)).toBe(false);
  });

  it('is false when there is no content-type at all', () => {
    const res = new Response('binary');
    expect(isJsonResponse(res)).toBe(false);
  });
});

describe('buildPassthroughResponseInit', () => {
  it('keeps content-type, content-disposition and status for a CSV download', () => {
    const res = new Response('Ad;Tutar\r\n"A";1.00\r\n', {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="faturalar.csv"',
      },
    });

    const init = buildPassthroughResponseInit(res);

    expect(init.status).toBe(200);
    expect(init.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(init.headers.get('content-disposition')).toBe('attachment; filename="faturalar.csv"');
  });

  it('strips hop-by-hop headers so they are never re-sent to the browser', () => {
    const res = new Response('x', {
      headers: {
        'content-type': 'application/pdf',
        connection: 'keep-alive',
        'transfer-encoding': 'chunked',
      },
    });

    const init = buildPassthroughResponseInit(res);

    expect(init.headers.get('connection')).toBeNull();
    expect(init.headers.get('transfer-encoding')).toBeNull();
    expect(init.headers.get('content-type')).toBe('application/pdf');
  });

  it('preserves a non-2xx status (e.g. a 404 from the API) on passthrough', () => {
    const res = new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    expect(buildPassthroughResponseInit(res).status).toBe(404);
  });
});
