import {
  CreateFunnelSchema,
  READY_MADE_FUNNELS,
  UpdateFunnelSchema,
  aggregateFunnelPaths,
  buildFunnelSteps,
  compareFunnelSteps,
  findReadyMadeFunnel,
  medianOf,
  pickDurationUnit,
  resolveFunnelPath,
  FUNNEL_STEP_KEYS,
  FUNNEL_VISIT_STEP,
} from './funnels';
import type { FunnelStepKey } from './funnels';
import { CONVERSION_EVENT_TYPES } from './growth/conversions';

const DAY = 24 * 60 * 60 * 1000;
const STEPS: FunnelStepKey[] = ['lead', 'trial_booked', 'trial_attended', 'purchase'];
const ev = (step: FunnelStepKey, days: number) => ({ step, at: days * DAY });

describe('funnel definitions', () => {
  it('accepts 2-6 distinct event types and a window', () => {
    const ok = CreateFunnelSchema.safeParse({ name: ' Deneme ', steps: ['lead', 'purchase'], windowDays: 14 });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.name).toBe('Deneme');
  });

  it('defaults the window to none', () => {
    const r = CreateFunnelSchema.parse({ name: 'x', steps: ['lead', 'purchase'] });
    expect(r.windowDays).toBeNull();
  });

  it('rejects fewer than 2 or more than 6 steps, duplicates, unknown types and the visit pseudo step', () => {
    const bad = (steps: unknown) => CreateFunnelSchema.safeParse({ name: 'x', steps }).success;
    expect(bad(['lead'])).toBe(false);
    expect(bad([...CONVERSION_EVENT_TYPES.slice(0, 7)])).toBe(false);
    expect(bad(['lead', 'lead'])).toBe(false);
    expect(bad(['lead', 'nope'])).toBe(false);
    expect(bad([FUNNEL_VISIT_STEP, 'lead'])).toBe(false);
    expect(bad(CONVERSION_EVENT_TYPES.slice(0, 6))).toBe(true);
  });

  it('rejects an empty name, an out of range window and extra keys', () => {
    expect(CreateFunnelSchema.safeParse({ name: ' ', steps: ['lead', 'purchase'] }).success).toBe(false);
    expect(CreateFunnelSchema.safeParse({ name: 'x', steps: ['lead', 'purchase'], windowDays: 0 }).success).toBe(false);
    expect(CreateFunnelSchema.safeParse({ name: 'x', steps: ['lead', 'purchase'], windowDays: 366 }).success).toBe(false);
    expect(CreateFunnelSchema.safeParse({ name: 'x', steps: ['lead', 'purchase'], studioId: 'a' }).success).toBe(false);
  });

  it('update needs at least one field', () => {
    expect(UpdateFunnelSchema.safeParse({}).success).toBe(false);
    expect(UpdateFunnelSchema.safeParse({ windowDays: null }).success).toBe(true);
  });

  it('ready-made funnels use known steps; only the visit step is a pseudo step and only first', () => {
    expect(READY_MADE_FUNNELS.length).toBeGreaterThanOrEqual(3);
    for (const f of READY_MADE_FUNNELS) {
      expect(f.steps.length).toBeGreaterThanOrEqual(2);
      f.steps.forEach((s, i) => {
        expect(FUNNEL_STEP_KEYS).toContain(s);
        if (s === FUNNEL_VISIT_STEP) expect(i).toBe(0);
      });
      expect(f.requiresSiteTracking).toBe(f.steps[0] === FUNNEL_VISIT_STEP);
      expect(findReadyMadeFunnel(f.id)).toBe(f);
    }
    expect(findReadyMadeFunnel('nope')).toBeUndefined();
  });
});

describe('medianOf', () => {
  it('handles empty, odd and even counts', () => {
    expect(medianOf([])).toBeNull();
    expect(medianOf([5])).toBe(5);
    expect(medianOf([9, 1, 5])).toBe(5);
    expect(medianOf([1, 2, 3, 10])).toBe(2.5);
  });
});

describe('resolveFunnelPath', () => {
  it('follows the steps in order', () => {
    expect(resolveFunnelPath([ev('lead', 0), ev('trial_booked', 1), ev('trial_attended', 2), ev('purchase', 3)], STEPS, null)).toEqual([0, DAY, 2 * DAY, 3 * DAY]);
  });

  it('does not count a step that happened before the previous one', () => {
    // trial_attended before trial_booked: the funnel stops at trial_booked.
    expect(resolveFunnelPath([ev('lead', 0), ev('trial_booked', 5), ev('trial_attended', 2)], STEPS, null)).toEqual([0, 5 * DAY, null, null]);
  });

  it('a later step skips an early out-of-order event and takes the first valid one', () => {
    expect(resolveFunnelPath([ev('lead', 1), ev('purchase', 0), ev('trial_booked', 2), ev('trial_attended', 3), ev('purchase', 9)], STEPS, null)).toEqual([DAY, 2 * DAY, 3 * DAY, 9 * DAY]);
  });

  it('stops at a missing step even if a later one exists', () => {
    expect(resolveFunnelPath([ev('lead', 0), ev('purchase', 4)], STEPS, null)).toEqual([0, null, null, null]);
  });

  it('applies the step-to-step window (inclusive) from the previous step', () => {
    const events = [ev('lead', 0), ev('trial_booked', 7), ev('trial_attended', 16), ev('purchase', 17)];
    expect(resolveFunnelPath(events, STEPS, 7)).toEqual([0, 7 * DAY, null, null]);
    expect(resolveFunnelPath(events, STEPS, 9)).toEqual([0, 7 * DAY, 16 * DAY, 17 * DAY]);
  });

  it('takes the earliest event of the first step', () => {
    expect(resolveFunnelPath([ev('lead', 5), ev('lead', 2), ev('trial_booked', 6)], STEPS.slice(0, 2), null)).toEqual([2 * DAY, 6 * DAY]);
  });

  it('a contact with no first step has an empty path', () => {
    expect(resolveFunnelPath([ev('purchase', 1)], STEPS, null)).toEqual([null, null, null, null]);
  });
});

describe('aggregateFunnelPaths and buildFunnelSteps', () => {
  const range = { from: 0, to: 10 * DAY };
  const paths = [
    [0, DAY, 3 * DAY, 4 * DAY], // completes
    [DAY, 3 * DAY, null, null], // drops after booking
    [2 * DAY, null, null, null], // drops after lead
    [20 * DAY, 21 * DAY, null, null], // outside the entry range
    [null, null, null, null], // never entered
  ];

  it('counts contacts entering in range per step and takes the median step time', () => {
    const agg = aggregateFunnelPaths(paths, 4, range);
    expect(agg.counts).toEqual([3, 2, 1, 1]);
    // trial_booked: (1 day, 2 days) -> 1.5 days
    expect(agg.medianSeconds[1]).toBe(1.5 * 86400);
    expect(agg.medianSeconds[2]).toBe(2 * 86400);
    expect(agg.medianSeconds[0]).toBeNull();
  });

  it('computes rates from the previous and from the first step', () => {
    const steps = buildFunnelSteps(STEPS, aggregateFunnelPaths(paths, 4, range));
    expect(steps.map((s) => s.reached)).toEqual([3, 2, 1, 1]);
    expect(steps[0].rateFromPrevious).toBeNull();
    expect(steps[0].rateFromFirst).toBe(1);
    expect(steps[1].rateFromPrevious).toBeCloseTo(2 / 3);
    expect(steps[2].rateFromPrevious).toBeCloseTo(1 / 2);
    expect(steps[3].rateFromPrevious).toBe(1);
    expect(steps[3].rateFromFirst).toBeCloseTo(1 / 3);
  });

  it('has null rates and no median for an empty funnel', () => {
    const steps = buildFunnelSteps(STEPS, aggregateFunnelPaths([], 4, range));
    expect(steps.every((s) => s.reached === 0 && s.rateFromFirst === null && s.rateFromPrevious === null && s.medianSecondsFromPrevious === null)).toBe(true);
  });
});

describe('compareFunnelSteps', () => {
  it('compares reached counts and the rate from the first step', () => {
    const cur = buildFunnelSteps(['lead', 'purchase'], { counts: [10, 5], medianSeconds: [null, 60] });
    const prev = buildFunnelSteps(['lead', 'purchase'], { counts: [10, 2], medianSeconds: [null, 60] });
    const cmp = compareFunnelSteps(cur, prev);
    expect(cmp[1].reached.changeRatio).toBeCloseTo(1.5);
    expect(cmp[1].reached.direction).toBe('up');
    expect(cmp[1].rateFromFirstDelta).toBeCloseTo(0.3);
  });

  it('is neutral when the previous period is empty', () => {
    const cur = buildFunnelSteps(['lead', 'purchase'], { counts: [4, 1], medianSeconds: [null, 1] });
    const prev = buildFunnelSteps(['lead', 'purchase'], { counts: [0, 0], medianSeconds: [null, null] });
    const cmp = compareFunnelSteps(cur, prev);
    expect(cmp[0].reached.changeRatio).toBeNull();
    expect(cmp[1].rateFromFirstDelta).toBeNull();
  });
});

describe('pickDurationUnit', () => {
  it('picks minutes, hours and days', () => {
    expect(pickDurationUnit(90)).toEqual({ unit: 'minute', value: 2 });
    expect(pickDurationUnit(5400)).toEqual({ unit: 'hour', value: 1.5 });
    expect(pickDurationUnit(3 * 86400)).toEqual({ unit: 'day', value: 3 });
  });
});
