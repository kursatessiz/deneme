import { serializeJsonLd } from './json-ld';

describe('serializeJsonLd', () => {
  it('never lets a value close the script tag', () => {
    const out = serializeJsonLd({ name: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
  });

  it('round-trips to the same data', () => {
    const data = { a: 'x < y & z > w', b: 'line\u2028sep', c: [1, 2] };
    expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
  });
});
