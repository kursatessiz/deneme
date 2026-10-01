import { buildLlmsTxt, llmsText } from './index';

describe('sites/llms.txt', () => {
  it('builds a title, a summary and linked sections', () => {
    const txt = buildLlmsTxt({
      name: 'Zen Studio',
      summary: 'Reformer pilates in Kadikoy',
      sections: [
        { title: 'Pages', links: [{ title: 'Home', url: 'https://zen.example.com/tr', description: 'Welcome' }, { title: 'Prices', url: 'https://zen.example.com/tr/fiyatlar' }] },
        { title: 'Blog', links: [{ title: 'Blog', url: 'https://zen.example.com/tr/blog' }] },
      ],
    });
    expect(txt).toBe(
      '# Zen Studio\n\n> Reformer pilates in Kadikoy\n\n## Pages\n\n- [Home](https://zen.example.com/tr): Welcome\n- [Prices](https://zen.example.com/tr/fiyatlar)\n\n## Blog\n\n- [Blog](https://zen.example.com/tr/blog)\n',
    );
  });

  it('omits an empty summary and sections without a usable link', () => {
    const txt = buildLlmsTxt({ name: 'Zen', summary: '  ', sections: [{ title: 'Services', links: [] }, { title: 'Pages', links: [{ title: 'Home', url: 'javascript:alert(1)' }] }] });
    expect(txt).toBe('# Zen\n');
  });

  it('neutralises Markdown and line breaks in tenant data', () => {
    expect(llmsText('Pilates [x](http://evil)\n## heading')).toBe('Pilates x(http://evil) ## heading');
    const txt = buildLlmsTxt({ name: 'A\n# B', sections: [{ title: 'S', links: [{ title: 'Link ] (x', url: 'https://a.example/x' }] }] });
    expect(txt.split('\n').filter((l) => l.startsWith('#'))).toEqual(['# A # B', '## S']);
    expect(txt).toContain('- [Link (x](https://a.example/x)');
  });

  it('rejects link targets that are not plain http(s) URLs', () => {
    const txt = buildLlmsTxt({ name: 'Zen', sections: [{ title: 'Pages', links: [{ title: 'a', url: 'https://x.example/a b' }, { title: 'b', url: 'https://x.example/(b)' }, { title: 'c', url: '/relative' }, { title: 'd', url: 'http://localhost:3000/d' }] }] });
    expect(txt).toBe('# Zen\n\n## Pages\n\n- [d](http://localhost:3000/d)\n');
  });
});
