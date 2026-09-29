import { homePathFor, postLoginPath, safeReturnPath } from './post-login';

const access = { permissions: [], platformStudioId: 'p', roleName: 'Pazarlama yöneticisi' };

describe('post-login routing', () => {
  it('tenant users keep landing on the dashboard', () => {
    expect(postLoginPath({ isSuperAdmin: false, platformAccess: null, mfa: { enabled: false, verified: false, enrollmentRequired: false } })).toBe('/dashboard');
    expect(homePathFor({ isSuperAdmin: false })).toBe('/dashboard');
  });

  it('platform accounts go to their console, through the TOTP step or enrolment when needed', () => {
    expect(postLoginPath({ isSuperAdmin: true, platformAccess: access, mfa: { enabled: false, verified: false, enrollmentRequired: false } })).toBe('/admin');
    expect(postLoginPath({ isSuperAdmin: true, platformAccess: access, mfa: { enabled: false, verified: false, enrollmentRequired: true } })).toBe(
      '/guvenlik/iki-adim?sonra=%2Fadmin',
    );
    expect(postLoginPath({ isSuperAdmin: false, platformAccess: access, mfa: { enabled: true, verified: false, enrollmentRequired: false } })).toBe(
      '/guvenlik/iki-adim?sonra=%2Fpazarlama',
    );
    expect(postLoginPath({ isSuperAdmin: false, platformAccess: access, mfa: { enabled: true, verified: true, enrollmentRequired: false } })).toBe('/pazarlama');
  });

  it('follows only same-app return paths', () => {
    expect(safeReturnPath('/pazarlama/kisiler', '/x')).toBe('/pazarlama/kisiler');
    expect(safeReturnPath('//evil.example', '/x')).toBe('/x');
    expect(safeReturnPath('https://evil.example', '/x')).toBe('/x');
    expect(safeReturnPath('/\\evil', '/x')).toBe('/x');
    expect(safeReturnPath(null, '/x')).toBe('/x');
  });
});
