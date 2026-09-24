import { isTabletWidth, selectLayout, TABLET_BREAKPOINT } from './layout';

describe('selectLayout', () => {
  it('treats widths below the breakpoint as phone', () => {
    expect(selectLayout(0)).toBe('phone');
    expect(selectLayout(767)).toBe('phone');
  });

  it('treats the breakpoint and above as tablet', () => {
    expect(selectLayout(TABLET_BREAKPOINT)).toBe('tablet');
    expect(selectLayout(1024)).toBe('tablet');
  });

  it('isTabletWidth mirrors selectLayout', () => {
    expect(isTabletWidth(375)).toBe(false);
    expect(isTabletWidth(834)).toBe(true);
  });
});
