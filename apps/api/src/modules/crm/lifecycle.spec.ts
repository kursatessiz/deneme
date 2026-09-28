import { ContactLifecycleStage, PipelineStageKind } from '@platform/database';
import { LIFECYCLE_STAGES, PIPELINE_STAGE_KINDS } from '@platform/shared';
import { furthestLifecycle, lifecycleEventForStage, nextLifecycle } from './lifecycle';

describe('contact lifecycle', () => {
  it('the database enums mirror the shared vocabulary', () => {
    expect(Object.values(ContactLifecycleStage).sort()).toEqual([...LIFECYCLE_STAGES].sort());
    expect(Object.values(PipelineStageKind).sort()).toEqual([...PIPELINE_STAGE_KINDS].sort());
  });

  it('member always wins', () => {
    for (const stage of LIFECYCLE_STAGES) expect(nextLifecycle(stage, 'member')).toBe('MEMBER');
  });

  it('only members lapse', () => {
    expect(nextLifecycle('MEMBER', 'lapsed')).toBe('LAPSED');
    expect(nextLifecycle('LEAD', 'lapsed')).toBe('LEAD');
    expect(nextLifecycle('TRIAL', 'lapsed')).toBe('TRIAL');
  });

  it('a trial never downgrades a member or a lapsed member', () => {
    expect(nextLifecycle('LEAD', 'trial')).toBe('TRIAL');
    expect(nextLifecycle('LOST', 'trial')).toBe('TRIAL');
    expect(nextLifecycle('MEMBER', 'trial')).toBe('MEMBER');
    expect(nextLifecycle('LAPSED', 'trial')).toBe('LAPSED');
  });

  it('a new inquiry re-engages only lost contacts', () => {
    expect(nextLifecycle('LOST', 'lead')).toBe('LEAD');
    expect(nextLifecycle('TRIAL', 'lead')).toBe('TRIAL');
    expect(nextLifecycle('MEMBER', 'lead')).toBe('MEMBER');
  });

  it('losing a deal never touches members', () => {
    expect(nextLifecycle('LEAD', 'lost')).toBe('LOST');
    expect(nextLifecycle('TRIAL', 'lost')).toBe('LOST');
    expect(nextLifecycle('MEMBER', 'lost')).toBe('MEMBER');
    expect(nextLifecycle('LAPSED', 'lost')).toBe('LAPSED');
  });

  it('maps pipeline stages to lifecycle events', () => {
    expect(lifecycleEventForStage('WON', 'WON')).toBe('member');
    expect(lifecycleEventForStage('LOST', 'LOST')).toBe('lost');
    expect(lifecycleEventForStage('TRIAL_BOOKED', 'OPEN')).toBe('trial');
    expect(lifecycleEventForStage('TRIAL_DONE', 'OPEN')).toBe('trial');
    expect(lifecycleEventForStage('CONTACTED', 'OPEN')).toBe('lead');
    expect(lifecycleEventForStage('CUSTOM_WIN', 'WON')).toBe('member');
  });

  it('merge keeps the further-along stage', () => {
    expect(furthestLifecycle('LEAD', 'MEMBER')).toBe('MEMBER');
    expect(furthestLifecycle('LAPSED', 'TRIAL')).toBe('LAPSED');
    expect(furthestLifecycle('LOST', 'LEAD')).toBe('LEAD');
  });
});
