import { VideoMeetingProviderKind } from '@platform/database';

/** Input needed to produce (or validate) a meeting link for a session. */
export interface MeetingLinkRequest {
  scheduleId: string;
  studioId: string;
  /** Only used by MANUAL: the https URL staff pasted in. */
  manualUrl?: string;
}

export interface MeetingLinkResult {
  provider: VideoMeetingProviderKind;
  url: string;
}

/**
 * Produces the meeting link stored on a SessionSchedule. Implementations
 * never return anything but an https URL - callers must not leak a link
 * from anywhere but SchedulesService.joinSession, and only within the join
 * window to a member with a confirmed/attended booking.
 */
export interface VideoMeetingProvider {
  readonly kind: VideoMeetingProviderKind;
  createLink(request: MeetingLinkRequest): MeetingLinkResult;
}
