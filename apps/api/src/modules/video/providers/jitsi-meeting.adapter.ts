import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VideoMeetingProviderKind } from '@platform/database';
import type { MeetingLinkRequest, MeetingLinkResult, VideoMeetingProvider } from './video-meeting-provider.interface';

/**
 * Generates a Jitsi Meet room URL under a configurable base (JITSI_BASE_URL,
 * defaults to the public meet.jit.si) with an unguessable room name: 16
 * random bytes (128 bits) hex-encoded, so no one can join by guessing a
 * schedule id or a short slug.
 */
@Injectable()
export class JitsiMeetingAdapter implements VideoMeetingProvider {
  readonly kind = VideoMeetingProviderKind.JITSI;

  constructor(private readonly config: ConfigService) {}

  createLink(_request: MeetingLinkRequest): MeetingLinkResult {
    const baseUrl = (this.config.get<string>('JITSI_BASE_URL') ?? 'https://meet.jit.si').replace(/\/+$/, '');
    const roomName = `studio-${randomBytes(16).toString('hex')}`;
    return { provider: this.kind, url: `${baseUrl}/${roomName}` };
  }
}
