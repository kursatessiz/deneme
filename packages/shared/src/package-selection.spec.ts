import { selectUsablePackage, type PackageCandidate } from './package-selection';

const NOW = new Date('2026-06-01T10:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

function pkg(over: Partial<PackageCandidate> & { id: string }): PackageCandidate {
  return {
    entitlementKind: 'SESSION_COUNT',
    status: 'ACTIVE',
    endDate: day(30),
    createdAt: day(-10),
    frozenUntil: null,
    remainingUnits: 5,
    unitCost: 1,
    ...over,
  };
}

const KINDS = ['SESSION_COUNT', 'CREDIT', 'TIME_UNLIMITED'] as const;

describe('selectUsablePackage', () => {
  it('prefers the package that expires soonest', () => {
    const picked = selectUsablePackage([pkg({ id: 'late', endDate: day(60) }), pkg({ id: 'soon', endDate: day(5) })], KINDS, NOW);
    expect(picked?.id).toBe('soon');
  });

  it('breaks an expiry tie with the oldest package, then the id', () => {
    const picked = selectUsablePackage(
      [pkg({ id: 'b', createdAt: day(-2) }), pkg({ id: 'a', createdAt: day(-20) }), pkg({ id: 'c', createdAt: day(-20) })],
      KINDS,
      NOW,
    );
    expect(picked?.id).toBe('a');
  });

  it('skips inactive, expired, frozen, uncovered, disallowed and empty packages', () => {
    const picked = selectUsablePackage(
      [
        pkg({ id: 'frozen-status', status: 'FROZEN' }),
        pkg({ id: 'depleted', status: 'DEPLETED', remainingUnits: 0 }),
        pkg({ id: 'expired', endDate: day(-1) }),
        pkg({ id: 'frozen-until', frozenUntil: day(3) }),
        pkg({ id: 'uncovered', unitCost: null }),
        pkg({ id: 'kind', entitlementKind: 'CREDIT' }),
        pkg({ id: 'empty', remainingUnits: 0 }),
        pkg({ id: 'ok', endDate: day(90) }),
      ],
      ['SESSION_COUNT'],
      NOW,
    );
    expect(picked?.id).toBe('ok');
  });

  it('treats a package whose frozenUntil has passed as usable', () => {
    expect(selectUsablePackage([pkg({ id: 'thawed', frozenUntil: day(-1) })], KINDS, NOW)?.id).toBe('thawed');
  });

  it('needs the credit cost for CREDIT packages', () => {
    const credit = (id: string, remainingUnits: number) => pkg({ id, entitlementKind: 'CREDIT', remainingUnits, unitCost: 3 });
    expect(selectUsablePackage([credit('short', 2)], KINDS, NOW)).toBeNull();
    expect(selectUsablePackage([credit('short', 2), credit('enough', 3)], KINDS, NOW)?.id).toBe('enough');
  });

  it('lets unlimited packages pay without units', () => {
    const unlimited = pkg({ id: 'unl', entitlementKind: 'TIME_UNLIMITED', remainingUnits: null });
    expect(selectUsablePackage([unlimited], KINDS, NOW)?.id).toBe('unl');
  });

  it('returns null without candidates', () => {
    expect(selectUsablePackage([], KINDS, NOW)).toBeNull();
  });

  it('does not filter by kind when the service lists none', () => {
    expect(selectUsablePackage([pkg({ id: 'x' })], [], NOW)?.id).toBe('x');
  });
});
