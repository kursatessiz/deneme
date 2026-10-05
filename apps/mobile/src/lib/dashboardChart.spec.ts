import { chartGeometry, labelIndexes, niceMax } from './dashboardChart';

const box = { left: 10, top: 0, right: 110, bottom: 50 };

describe('niceMax', () => {
  it('rounds up to 1, 2, 5 or 10 times a power of ten', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(0.7)).toBe(1);
    expect(niceMax(1.4)).toBe(2);
    expect(niceMax(37)).toBe(50);
    expect(niceMax(620)).toBe(1000);
  });
});

describe('chartGeometry', () => {
  it('plots first and last values on the box edges, highest value at the top', () => {
    const g = chartGeometry([0, 5, 10], box, 10);
    expect(g.points[0]).toEqual({ x: 10, y: 50 });
    expect(g.points[2]).toEqual({ x: 110, y: 0 });
    expect(g.line.startsWith('M10.0,50.0')).toBe(true);
    expect(g.area.endsWith('Z')).toBe(true);
  });

  it('derives the axis maximum from the data and clamps to it', () => {
    expect(chartGeometry([3, 40], box).max).toBe(50);
    expect(chartGeometry([2], box, 1).points[0].y).toBe(0);
  });

  it('centres a single point and returns empty paths without data', () => {
    expect(chartGeometry([1], box).points[0].x).toBe(60);
    expect(chartGeometry([], box)).toEqual({ max: 1, points: [], line: '', area: '' });
  });
});

describe('labelIndexes', () => {
  it('always includes first and last', () => {
    expect(labelIndexes(30, 320)).toEqual(expect.arrayContaining([0, 29]));
    expect(labelIndexes(2, 20)).toEqual([0, 1]);
  });

  it('handles empty and single', () => {
    expect(labelIndexes(0, 100)).toEqual([]);
    expect(labelIndexes(1, 100)).toEqual([0]);
  });
});
