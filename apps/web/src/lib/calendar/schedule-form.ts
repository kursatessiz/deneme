import { CreateScheduleSchema, UpdateScheduleSchema, SessionDeliveryMode } from '@platform/shared';
import type { CreateScheduleInput, UpdateScheduleInput } from '@platform/shared';
import { validationMessageOf } from '@/lib/i18n/client-translator';

export interface ScheduleFormValues {
  studioId: string;
  branchId: string;
  serviceTypeId: string;
  resourceId: string;
  trainerId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity: string;
  isRecurring: boolean;
  recurringWeeks: string;
  deliveryMode: SessionDeliveryMode;
  meetingProvider: string;
  manualMeetingUrl: string;
}

function toIsoDateTime(date: string, time: string): string {
  // date="2026-03-17", time="09:00" -> a local ISO instant the API accepts.
  const local = new Date(`${date}T${time}:00`);
  return local.toISOString();
}

/**
 * Turns the create-session form's raw string fields into CreateScheduleSchema's shape and validates it.
 * `invalidMessage`: the active translator's `common.invalidForm` value, since this is a plain lib function without hook access.
 */
export function validateScheduleForm(
  values: ScheduleFormValues,
  invalidMessage: string,
): { success: true; data: CreateScheduleInput } | { success: false; message: string } {
  const payload = {
    studioId: values.studioId,
    branchId: values.branchId || undefined,
    serviceTypeId: values.serviceTypeId,
    resourceId: values.resourceId || undefined,
    trainerId: values.trainerId || undefined,
    title: values.title,
    startTime: toIsoDateTime(values.date, values.startTime),
    endTime: toIsoDateTime(values.date, values.endTime),
    capacity: values.capacity ? Number(values.capacity) : undefined,
    isRecurring: values.isRecurring,
    recurringWeeks: values.isRecurring && values.recurringWeeks ? Number(values.recurringWeeks) : undefined,
    deliveryMode: values.deliveryMode,
    meetingProvider: values.meetingProvider || undefined,
    manualMeetingUrl: values.manualMeetingUrl || undefined,
  };
  const result = CreateScheduleSchema.safeParse(payload);
  if (result.success) return { success: true, data: result.data };
  return { success: false, message: validationMessageOf(result.error.issues[0]?.message, invalidMessage) };
}

/**
 * A drag-drop move: only the new start/end, validated against UpdateScheduleSchema.
 * `invalidMessage`: the active translator's `common.invalidTimeRange` value, since this is a plain lib function without hook access.
 */
export function validateScheduleMove(
  startTime: Date,
  endTime: Date,
  invalidMessage: string,
): { success: true; data: UpdateScheduleInput } | { success: false; message: string } {
  const result = UpdateScheduleSchema.safeParse({ startTime: startTime.toISOString(), endTime: endTime.toISOString() });
  if (result.success) return { success: true, data: result.data };
  return { success: false, message: validationMessageOf(result.error.issues[0]?.message, invalidMessage) };
}
