import { CHURN_REASON_KEYS, CHURN_REASON_LABELS, ChurnWeightsSchema, DEFAULT_CHURN_WEIGHTS, parseChurnWeights } from './churn';

describe('parseChurnWeights', () => {
  it('falls back to defaults for null/garbage', () => {
    expect(parseChurnWeights(null)).toEqual(DEFAULT_CHURN_WEIGHTS);
    expect(parseChurnWeights(undefined)).toEqual(DEFAULT_CHURN_WEIGHTS);
    expect(parseChurnWeights({ not: 'valid' })).toEqual(DEFAULT_CHURN_WEIGHTS);
    expect(parseChurnWeights('nonsense')).toEqual(DEFAULT_CHURN_WEIGHTS);
  });

  it('accepts a tenant override', () => {
    const custom = { ...DEFAULT_CHURN_WEIGHTS, attendanceDeclineWeight: 30 };
    expect(parseChurnWeights(custom)).toEqual(custom);
  });

  it('rejects mediumThreshold >= highThreshold', () => {
    const result = ChurnWeightsSchema.safeParse({ mediumThreshold: 80, highThreshold: 70 });
    expect(result.success).toBe(false);
  });
});

describe('CHURN_REASON_LABELS', () => {
  it('has a Turkish label for every reason key', () => {
    for (const key of CHURN_REASON_KEYS) {
      expect(CHURN_REASON_LABELS[key]).toBeTruthy();
    }
  });
});
