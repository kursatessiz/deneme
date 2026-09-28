import type { LifecycleStage, PipelineStageKind } from '@platform/shared';

/**
 * What happened to a contact, as far as its lifecycle is concerned. The
 * business hooks (member joined, trial booked, payment, package expiry,
 * pipeline moves) report one of these; nextLifecycle decides the stage.
 */
export type LifecycleEvent = 'lead' | 'trial' | 'member' | 'lapsed' | 'lost';

/**
 * Lifecycle transition rules (docs/CRM_VE_ATIF.md):
 * - member: any stage becomes MEMBER (joined, paid, won)
 * - lapsed: only a MEMBER lapses (no active package left)
 * - trial:  a LEAD or LOST contact becomes TRIAL; members stay members
 * - lead:   a LOST contact re-engages as LEAD; nobody is downgraded to LEAD
 * - lost:   only LEAD or TRIAL can be lost; a (lapsed) member stays one
 */
export function nextLifecycle(current: LifecycleStage, event: LifecycleEvent): LifecycleStage {
  switch (event) {
    case 'member':
      return 'MEMBER';
    case 'lapsed':
      return current === 'MEMBER' ? 'LAPSED' : current;
    case 'trial':
      return current === 'LEAD' || current === 'LOST' ? 'TRIAL' : current;
    case 'lead':
      return current === 'LOST' ? 'LEAD' : current;
    case 'lost':
      return current === 'LEAD' || current === 'TRIAL' ? 'LOST' : current;
  }
}

/** Lifecycle event implied by moving a contact onto a pipeline stage. */
export function lifecycleEventForStage(key: string, kind: PipelineStageKind): LifecycleEvent {
  if (kind === 'WON') return 'member';
  if (kind === 'LOST') return 'lost';
  if (key === 'TRIAL_BOOKED' || key === 'TRIAL_DONE') return 'trial';
  return 'lead';
}

const RANK: Record<LifecycleStage, number> = { LOST: 0, LEAD: 1, TRIAL: 2, LAPSED: 3, MEMBER: 4 };

/** The further-along of two stages; used when merging two contacts. */
export function furthestLifecycle(a: LifecycleStage, b: LifecycleStage): LifecycleStage {
  return RANK[a] >= RANK[b] ? a : b;
}
