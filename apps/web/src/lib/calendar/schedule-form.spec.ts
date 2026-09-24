import { SessionDeliveryMode, VideoMeetingProviderKind } from '@platform/shared';
import { validateScheduleForm, validateScheduleMove, type ScheduleFormValues } from './schedule-form';

const base: ScheduleFormValues = {
  studioId: '11111111-1111-4111-8111-111111111111',
  branchId: '',
  serviceTypeId: '22222222-2222-4222-8222-222222222222',
  resourceId: '',
  trainerId: '',
  title: 'Sabah seansı',
  date: '2026-03-17',
  startTime: '09:00',
  endTime: '10:00',
  capacity: '',
  isRecurring: false,
  recurringWeeks: '',
  deliveryMode: SessionDeliveryMode.IN_PERSON,
  meetingProvider: '',
  manualMeetingUrl: '',
};

describe('validateScheduleForm', () => {
  it('accepts a minimal in-person session', () => {
    const result = validateScheduleForm(base);
    expect(result.success).toBe(true);
  });

  it('rejects an end time before the start time', () => {
    const result = validateScheduleForm({ ...base, startTime: '10:00', endTime: '09:00' });
    expect(result.success).toBe(false);
  });

  it('rejects a title shorter than 3 characters', () => {
    const result = validateScheduleForm({ ...base, title: 'Ab' });
    expect(result.success).toBe(false);
  });

  it('requires a meeting provider for an online session', () => {
    const result = validateScheduleForm({ ...base, deliveryMode: SessionDeliveryMode.ONLINE });
    expect(result.success).toBe(false);
  });

  it('accepts an online session with a manual meeting link', () => {
    const result = validateScheduleForm({
      ...base,
      deliveryMode: SessionDeliveryMode.ONLINE,
      meetingProvider: VideoMeetingProviderKind.MANUAL,
      manualMeetingUrl: 'https://meet.example.com/abc',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a manual meeting link that is not https', () => {
    const result = validateScheduleForm({
      ...base,
      deliveryMode: SessionDeliveryMode.ONLINE,
      meetingProvider: VideoMeetingProviderKind.MANUAL,
      manualMeetingUrl: 'http://meet.example.com/abc',
    });
    expect(result.success).toBe(false);
  });

  it('carries recurrence fields through when isRecurring is set', () => {
    const result = validateScheduleForm({ ...base, isRecurring: true, recurringWeeks: '4' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isRecurring).toBe(true);
      expect(result.data.recurringWeeks).toBe(4);
    }
  });
});

describe('validateScheduleMove', () => {
  it('accepts a valid new time range', () => {
    const start = new Date(2026, 2, 17, 9, 0);
    const end = new Date(2026, 2, 17, 10, 0);
    expect(validateScheduleMove(start, end).success).toBe(true);
  });

  it('rejects a range where end is before start', () => {
    const start = new Date(2026, 2, 17, 10, 0);
    const end = new Date(2026, 2, 17, 9, 0);
    expect(validateScheduleMove(start, end).success).toBe(false);
  });
});
