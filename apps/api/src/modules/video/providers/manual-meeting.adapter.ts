import { Injectable, BadRequestException } from '@nestjs/common';
import { VideoMeetingProviderKind } from '@platform/database';
import type { MeetingLinkRequest, MeetingLinkResult, VideoMeetingProvider } from './video-meeting-provider.interface';

/**
 * Staff pastes an existing Zoom/Meet/Jitsi/other URL. Validated https-only;
 * the schema layer already checks this (HttpsUrlSchema), this is a second,
 * defensive check at the service boundary.
 */
@Injectable()
export class ManualMeetingAdapter implements VideoMeetingProvider {
  readonly kind = VideoMeetingProviderKind.MANUAL;

  createLink(request: MeetingLinkRequest): MeetingLinkResult {
    const url = request.manualUrl?.trim();
    if (!url || !url.startsWith('https://')) {
      throw new BadRequestException('Elle bağlantı için geçerli bir https bağlantısı gereklidir');
    }
    return { provider: this.kind, url };
  }
}
