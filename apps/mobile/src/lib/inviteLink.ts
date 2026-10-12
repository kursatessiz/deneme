import { AcceptInviteSchema } from '@platform/shared';
import type { AcceptInviteInput } from '@platform/shared';

/** Same shape the API enforces for an invite token (256 bit, base64url); anything else is never sent. */
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isInviteToken(value: unknown): value is string {
  return typeof value === 'string' && INVITE_TOKEN_PATTERN.test(value);
}

export type InviteAcceptResult =
  | { ok: true; body: AcceptInviteInput }
  | { ok: false; issues: { message: string }[] };

/**
 * Body of POST /invites/:token/accept, validated with the shared schema the API uses: the six digit
 * code, an optional six digit PIN (empty means none) and the ids of every document shown.
 */
export function buildAcceptBody(input: { code: string; pin: string; documentIds: string[]; device: string }): InviteAcceptResult {
  const parsed = AcceptInviteSchema.safeParse({
    code: input.code,
    ...(input.pin !== '' ? { pin: input.pin } : {}),
    acceptedDocumentVersionIds: input.documentIds,
    device: input.device,
  });
  return parsed.success ? { ok: true, body: parsed.data } : { ok: false, issues: parsed.error.issues };
}
