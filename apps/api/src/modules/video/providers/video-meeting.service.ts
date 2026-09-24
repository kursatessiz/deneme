import { Injectable } from '@nestjs/common';
import { VideoMeetingProviderKind } from '@platform/database';
import { ManualMeetingAdapter } from './manual-meeting.adapter';
import { JitsiMeetingAdapter } from './jitsi-meeting.adapter';
import type { MeetingLinkRequest, MeetingLinkResult } from './video-meeting-provider.interface';

/** Picks the right adapter for a meeting-link request by provider kind. */
@Injectable()
export class VideoMeetingService {
  constructor(
    private readonly manual: ManualMeetingAdapter,
    private readonly jitsi: JitsiMeetingAdapter,
  ) {}

  createLink(providerKind: VideoMeetingProviderKind, request: MeetingLinkRequest): MeetingLinkResult {
    const adapter = providerKind === VideoMeetingProviderKind.MANUAL ? this.manual : this.jitsi;
    return adapter.createLink(request);
  }
}
