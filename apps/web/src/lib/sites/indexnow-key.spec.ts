import { indexNowKeyFromPath } from './indexnow-key';

describe('indexNowKeyFromPath', () => {
  const key = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

  it('extracts the key of a key file path', () => {
    expect(indexNowKeyFromPath(`/${key}.txt`)).toBe(key);
  });

  it('ignores every other path', () => {
    expect(indexNowKeyFromPath('/robots.txt')).toBeNull();
    expect(indexNowKeyFromPath('/llms.txt')).toBeNull();
    expect(indexNowKeyFromPath(`/${key}`)).toBeNull();
    expect(indexNowKeyFromPath(`/tr/${key}.txt`)).toBeNull();
    expect(indexNowKeyFromPath(`/${key.toUpperCase()}.txt`)).toBeNull();
    expect(indexNowKeyFromPath(`/${key}0.txt`)).toBeNull();
  });
});
