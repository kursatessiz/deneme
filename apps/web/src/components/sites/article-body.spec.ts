import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArticleBody } from './ArticleBody';

const render = (body: string) => renderToStaticMarkup(createElement(ArticleBody, { body }));

describe('ArticleBody', () => {
  it('renders headings, paragraphs with line breaks, lists, bold and https links', () => {
    const html = render('## Title\n\nFirst line\nsecond **bold**\n\n- one\n- [two](https://example.com/x)');
    expect(html).toContain('<h2 class="ui-heading">Title</h2>');
    expect(html).toContain('<p>First line<br/>second <strong class="ui-strong">bold</strong></p>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<a href="https://example.com/x" target="_blank" rel="noopener noreferrer" class="pui-link">two</a>');
  });

  it('escapes HTML instead of passing it through', () => {
    const html = render('<script>alert(1)</script> <img src=x onerror=alert(1)> **<b>x</b>**');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('never renders a non-https link', () => {
    for (const target of ['javascript:alert(1)', 'http://example.com', 'data:text/html,x', '//example.com', '/local']) {
      const html = render(`[click](${target})`);
      expect(html).not.toContain('<a');
      expect(html).toContain('click');
    }
  });
});
