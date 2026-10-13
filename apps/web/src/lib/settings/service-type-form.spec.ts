import { EntitlementKind } from '@platform/shared';
import { buildCreateServiceType, buildUpdateServiceType, diffQualifications, emptyServiceTypeForm } from './service-type-form';

const STUDIO = '11111111-1111-4111-8111-111111111111';
const RES = '22222222-2222-4222-8222-222222222222';

describe('buildCreateServiceType', () => {
  it('accepts a minimal valid form', () => {
    const res = buildCreateServiceType(STUDIO, { ...emptyServiceTypeForm(), name: 'Group session' }, 'bad number');
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.durationMin).toBe(60);
      expect(res.data.minRepeatIntervalDays).toBeUndefined();
    }
  });

  it('translates rule messages and falls back for bad numbers', () => {
    const res = buildCreateServiceType(
      STUDIO,
      { ...emptyServiceTypeForm(), name: 'a', durationMin: 'abc', allowedEntitlementKinds: [] },
      'bad number',
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors.name).toBe('Hizmet adı en az 2 karakter olmalıdır');
      expect(res.errors.durationMin).toBe('bad number');
      expect(res.errors.allowedEntitlementKinds).toBe('En az bir hak türü seçilmelidir');
    }
  });

  it('maps required resource types with quantities', () => {
    const res = buildCreateServiceType(STUDIO, { ...emptyServiceTypeForm(), name: 'Reformer', resourceQuantities: { [RES]: '2' } }, 'x');
    expect(res.success && res.data.requiredResourceTypes).toEqual([{ resourceTypeId: RES, quantity: 2 }]);
  });
});

describe('buildUpdateServiceType', () => {
  it('sends null to clear the repeat interval and optional links', () => {
    const res = buildUpdateServiceType(STUDIO, { ...emptyServiceTypeForm(), name: 'Reformer', allowedEntitlementKinds: [EntitlementKind.CREDIT] }, 'x');
    expect(res.success && res.data.minRepeatIntervalDays).toBeNull();
    expect(res.success && res.data.cancellationPolicyId).toBeNull();
  });

  it('keeps a positive repeat interval and rejects zero', () => {
    const ok = buildUpdateServiceType(STUDIO, { ...emptyServiceTypeForm(), name: 'Reformer', minRepeatIntervalDays: '7' }, 'x');
    expect(ok.success && ok.data.minRepeatIntervalDays).toBe(7);
    const bad = buildUpdateServiceType(STUDIO, { ...emptyServiceTypeForm(), name: 'Reformer', minRepeatIntervalDays: '0' }, 'x');
    expect(bad.success).toBe(false);
  });
});

describe('diffQualifications', () => {
  it('returns additions and removals', () => {
    expect(diffQualifications(['a', 'b'], ['b', 'c'])).toEqual({ add: ['c'], remove: ['a'] });
  });
});
