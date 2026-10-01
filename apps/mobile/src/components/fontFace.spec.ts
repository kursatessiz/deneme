import { faceForWeight, resolveFace } from './fontFace';

describe('faceForWeight', () => {
  it('maps numeric and named weights to Inter faces', () => {
    expect(faceForWeight(undefined)).toBe('Inter_400Regular');
    expect(faceForWeight('500')).toBe('Inter_500Medium');
    expect(faceForWeight('600')).toBe('Inter_600SemiBold');
    expect(faceForWeight('700')).toBe('Inter_700Bold');
    expect(faceForWeight('bold')).toBe('Inter_700Bold');
  });
});

describe('resolveFace', () => {
  it('defaults to the regular face', () => {
    expect(resolveFace(undefined, undefined)).toBe('Inter_400Regular');
  });

  it('keeps an Inter family when no weight is set', () => {
    expect(resolveFace('Inter_600SemiBold', undefined)).toBe('Inter_600SemiBold');
  });

  it('lets a weight win over a family', () => {
    expect(resolveFace('Inter_400Regular', '700')).toBe('Inter_700Bold');
  });

  it('leaves a foreign family such as monospace alone', () => {
    expect(resolveFace('monospace', '400')).toBeNull();
  });
});
