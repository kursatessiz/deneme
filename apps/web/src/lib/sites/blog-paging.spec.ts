import { blogPagingRewrite, parseListPage } from './blog-paging';

describe('blogPagingRewrite', () => {
  it('maps ?page=N (N >= 2) on the blog index and a tag listing to path-based routes', () => {
    expect(blogPagingRewrite('/tr/blog', '2')).toBe('/tr/blog/page/2');
    expect(blogPagingRewrite('/en/blog/', '12')).toBe('/en/blog/page/12');
    expect(blogPagingRewrite('/tr/blog/tag/pilates-ipuclari', '3')).toBe('/tr/blog/tag/pilates-ipuclari/page/3');
  });

  it('leaves page 1, a missing or malformed page and other paths alone', () => {
    expect(blogPagingRewrite('/tr/blog', null)).toBeNull();
    expect(blogPagingRewrite('/tr/blog', '1')).toBeNull();
    expect(blogPagingRewrite('/tr/blog', '0')).toBeNull();
    expect(blogPagingRewrite('/tr/blog', '2abc')).toBeNull();
    expect(blogPagingRewrite('/tr/blog', '99999')).toBeNull();
    expect(blogPagingRewrite('/tr/blog/ilk-yazi', '2')).toBeNull();
    expect(blogPagingRewrite('/tr/hakkimizda', '2')).toBeNull();
    expect(blogPagingRewrite('/not a locale/blog', '2')).toBeNull();
  });
});

describe('parseListPage', () => {
  it('accepts page 2 to 9999 only', () => {
    expect(parseListPage('2')).toBe(2);
    expect(parseListPage('9999')).toBe(9999);
    expect(parseListPage('1')).toBeNull();
    expect(parseListPage('10000')).toBeNull();
    expect(parseListPage('abc')).toBeNull();
  });
});
