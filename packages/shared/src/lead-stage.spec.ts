import { LeadStage, canTransitionLeadStage } from './enums';

describe('canTransitionLeadStage', () => {
  it('allows the normal forward path', () => {
    expect(canTransitionLeadStage(LeadStage.NEW, LeadStage.CONTACTED)).toBe(true);
    expect(canTransitionLeadStage(LeadStage.CONTACTED, LeadStage.TRIAL_BOOKED)).toBe(true);
    expect(canTransitionLeadStage(LeadStage.TRIAL_BOOKED, LeadStage.TRIAL_DONE)).toBe(true);
    expect(canTransitionLeadStage(LeadStage.TRIAL_DONE, LeadStage.WON)).toBe(true);
  });

  it('allows WON or LOST from any open stage', () => {
    expect(canTransitionLeadStage(LeadStage.NEW, LeadStage.WON)).toBe(true);
    expect(canTransitionLeadStage(LeadStage.NEW, LeadStage.LOST)).toBe(true);
    expect(canTransitionLeadStage(LeadStage.CONTACTED, LeadStage.LOST)).toBe(true);
    expect(canTransitionLeadStage(LeadStage.TRIAL_BOOKED, LeadStage.LOST)).toBe(true);
  });

  it('never allows leaving WON', () => {
    for (const stage of Object.values(LeadStage)) {
      expect(canTransitionLeadStage(LeadStage.WON, stage)).toBe(false);
    }
  });

  it('never allows leaving LOST', () => {
    for (const stage of Object.values(LeadStage)) {
      expect(canTransitionLeadStage(LeadStage.LOST, stage)).toBe(false);
    }
  });

  it('rejects going backwards', () => {
    expect(canTransitionLeadStage(LeadStage.TRIAL_BOOKED, LeadStage.NEW)).toBe(false);
    expect(canTransitionLeadStage(LeadStage.TRIAL_DONE, LeadStage.CONTACTED)).toBe(false);
    expect(canTransitionLeadStage(LeadStage.CONTACTED, LeadStage.NEW)).toBe(false);
  });

  it('rejects a no-op transition to the same stage', () => {
    expect(canTransitionLeadStage(LeadStage.NEW, LeadStage.NEW)).toBe(false);
  });

  it('rejects skipping straight to TRIAL_DONE from NEW', () => {
    expect(canTransitionLeadStage(LeadStage.NEW, LeadStage.TRIAL_DONE)).toBe(false);
  });
});
