import { firstMissingPermissionLabel } from './permission-note';

describe('firstMissingPermissionLabel', () => {
  it('is null for an owner regardless of required permissions', () => {
    expect(firstMissingPermissionLabel(['packages.sell'], [], true)).toBeNull();
  });

  it('is null when required is empty', () => {
    expect(firstMissingPermissionLabel([], [], false)).toBeNull();
  });

  it('is null when the caller already has one of the required permissions', () => {
    expect(firstMissingPermissionLabel(['packages.sell', 'finance.manage'], ['finance.manage'], false)).toBeNull();
  });

  it('returns the catalogue label of the first required permission when none are granted', () => {
    expect(firstMissingPermissionLabel(['packages.sell'], ['members.view'], false)).toBe('Paket satışı, dondurma ve devir');
  });
});
