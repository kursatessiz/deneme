import { validationBaseMessage } from '../validation-messages';
import { AUTOMATION_RULE_TYPES } from '../automations';
import { DEFAULT_LEGACY_PARAMS, WIN_BACK_SEGMENT_PLACEHOLDER, journeyTemplates, legacyRuleFromJourney, legacyRuleToJourney, legacyTemplateRule, winBackSegmentRules } from './journey-api';
import { JourneyDefinitionSchema, nextLocalTime, validateJourneyGraph } from './journeys';
import { SegmentGroupSchema, validateSegmentRules } from './segments';
import { CreateSegmentSchema, UNAVAILABLE_SEGMENT_FIELDS, segmentFieldKind } from './segment-api';
import { CreateCampaignSchema } from './campaigns';
import { UpdateContactConsentSchema } from '../crm';

describe('journey templates and the legacy rule conversion', () => {
  it('every gallery template is a valid journey', () => {
    for (const template of journeyTemplates()) {
      const parsed = JourneyDefinitionSchema.parse(template.definition);
      expect({ key: template.key, issues: validateJourneyGraph(parsed) }).toEqual({ key: template.key, issues: [] });
    }
  });

  it('round-trips every legacy rule type through a journey', () => {
    for (const type of AUTOMATION_RULE_TYPES) {
      const rule = legacyTemplateRule(type);
      const def = legacyRuleToJourney(rule, { winBackSegmentId: WIN_BACK_SEGMENT_PLACEHOLDER });
      const params = DEFAULT_LEGACY_PARAMS[type];
      const winBack = params.type === 'WIN_BACK' ? winBackSegmentRules(params) : null;
      const back = legacyRuleFromJourney(type, def, winBack);
      expect(back.params).toEqual(params);
      expect(back.templateKey).toBe(rule.templateKey);
      expect(back.isTransactional).toBe(rule.isTransactional);
    }
  });

  it('keeps the legacy purpose, channel and member category on the send step', () => {
    const def = legacyRuleToJourney({ type: 'BIRTHDAY', params: { type: 'BIRTHDAY', daysBefore: 1 }, templateKey: 'BIRTHDAY', channel: 'SMS', isTransactional: false });
    const send = def.steps[def.entryStepId];
    expect(send).toMatchObject({ type: 'send', channel: 'SMS', allowFallback: false, purpose: 'COMMERCIAL', category: 'MARKETING' });
    expect(def.trigger).toEqual({ kind: 'event', event: 'birthday', daysBefore: 1 });
  });

  it('turns a follow-up delay into an entry wait step', () => {
    const def = legacyRuleToJourney({ type: 'NO_SHOW_FOLLOW_UP', params: { type: 'NO_SHOW_FOLLOW_UP', hoursAfter: 3 }, templateKey: 'NO_SHOW_FOLLOW_UP', channel: null, isTransactional: true });
    expect(def.steps[def.entryStepId]).toMatchObject({ type: 'wait', minutes: 180 });
  });

  it('win-back needs its audience segment', () => {
    expect(() => legacyRuleToJourney(legacyTemplateRule('WIN_BACK'))).toThrow();
    const rules = winBackSegmentRules({ type: 'WIN_BACK', noAttendanceDays: 30, requireNoActivePackage: true });
    expect(SegmentGroupSchema.safeParse(rules).success).toBe(true);
    expect(validateSegmentRules(rules)).toEqual([]);
  });
});

describe('journey validation additions', () => {
  const base = {
    trigger: { kind: 'event' as const, event: 'booking_upcoming' as const, leadMinutes: 120 },
    entryStepId: 'send',
    steps: { send: { type: 'send' as const, templateKey: 'BOOKING_REMINDER', purpose: 'TRANSACTIONAL' as const, next: null } },
  };

  it('accepts a send by template key without a channel', () => {
    expect(validateJourneyGraph(JourneyDefinitionSchema.parse(base))).toEqual([]);
  });

  it('requires trigger parameters and exactly one template reference', () => {
    const noLead = JourneyDefinitionSchema.parse({ ...base, trigger: { kind: 'event', event: 'booking_upcoming' } });
    expect(validateJourneyGraph(noLead).map(validationBaseMessage).join(' ')).toContain('Rezervasyon');
    const wrongParam = JourneyDefinitionSchema.parse({ ...base, trigger: { kind: 'event', event: 'lead', leadMinutes: 60 } });
    expect(validateJourneyGraph(wrongParam).map(validationBaseMessage).join(' ')).toContain('leadMinutes');
    const noTemplate = JourneyDefinitionSchema.parse({ ...base, steps: { send: { type: 'send', purpose: 'COMMERCIAL', next: null } } });
    expect(validateJourneyGraph(noTemplate).map(validationBaseMessage).join(' ')).toContain('templateKey');
    const pkg = JourneyDefinitionSchema.parse({ ...base, trigger: { kind: 'event', event: 'package_expiring' } });
    expect(validateJourneyGraph(pkg).map(validationBaseMessage).join(' ')).toContain('Paket');
  });

  it('accepts award_points (G3a) and requires a reason', () => {
    const def = JourneyDefinitionSchema.parse({
      ...base,
      steps: { send: { type: 'award_points', points: 10, reasonKey: 'Hos geldin puani', next: null } },
    });
    expect(validateJourneyGraph(def)).toEqual([]);
    const noReason = JourneyDefinitionSchema.parse({
      ...base,
      steps: { send: { type: 'award_points', points: 10, reasonKey: ' ', next: null } },
    });
    expect(validateJourneyGraph(noReason).map(validationBaseMessage).join(' ')).toContain('açıklama');
  });

  it('requires an assignee for role or user tasks', () => {
    const def = JourneyDefinitionSchema.parse({
      ...base,
      steps: { send: { type: 'create_task', titleKey: 'Call', assignTo: 'USER', dueInMinutes: 10, next: null } },
    });
    expect(validateJourneyGraph(def).map(validationBaseMessage).join(' ')).toContain('assigneeId');
  });
});

describe('nextLocalTime', () => {
  it('returns the same day when the time is still ahead, otherwise the next day', () => {
    const after = new Date('2026-03-10T06:00:00.000Z'); // 09:00 in Istanbul (UTC+3)
    expect(nextLocalTime(after, '10:30', 'Europe/Istanbul').toISOString()).toBe('2026-03-10T07:30:00.000Z');
    expect(nextLocalTime(after, '08:00', 'Europe/Istanbul').toISOString()).toBe('2026-03-11T05:00:00.000Z');
  });

  it('handles daylight saving and unknown zones', () => {
    // New York switches to UTC-4 on 2026-03-08.
    expect(nextLocalTime(new Date('2026-03-07T20:00:00.000Z'), '09:00', 'America/New_York').toISOString()).toBe('2026-03-08T13:00:00.000Z');
    expect(nextLocalTime(new Date('2026-03-10T06:00:00.000Z'), '09:00', 'Not/AZone').toISOString()).toBe('2026-03-10T09:00:00.000Z');
  });
});

describe('segment, campaign and consent contracts', () => {
  it('knows built-in and custom field kinds; the loyalty field is available since G3a', () => {
    expect(segmentFieldKind('activity.attendedTotal')).toBe('number');
    expect(segmentFieldKind('custom.goal', { goal: 'enum' })).toBe('enum');
    expect(segmentFieldKind('custom.missing')).toBeNull();
    expect(UNAVAILABLE_SEGMENT_FIELDS['loyalty.pointsBalance']).toBeUndefined();
    expect(segmentFieldKind('loyalty.pointsBalance')).toBe('number');
  });

  it('requires rules for a dynamic segment only', () => {
    expect(CreateSegmentSchema.safeParse({ name: 'x', kind: 'DYNAMIC' }).success).toBe(false);
    expect(CreateSegmentSchema.safeParse({ name: 'x', kind: 'STATIC' }).success).toBe(true);
  });

  it('validates campaign template keys', () => {
    const segmentId = '5b0c0f7e-2d1c-4c47-9d33-5f1a6f0e2b11';
    expect(CreateCampaignSchema.safeParse({ name: 'x', segmentId, templateKey: 'WIN_BACK' }).success).toBe(true);
    expect(CreateCampaignSchema.safeParse({ name: 'x', segmentId, templateKey: 'drop table' }).success).toBe(false);
  });

  it('requires evidence when staff grant consent', () => {
    expect(UpdateContactConsentSchema.safeParse({ channel: 'SMS', granted: true }).success).toBe(false);
    expect(UpdateContactConsentSchema.safeParse({ channel: 'SMS', granted: true, evidence: 'form' }).success).toBe(true);
    expect(UpdateContactConsentSchema.safeParse({ channel: 'SMS', granted: false }).success).toBe(true);
  });
});
