import { MembershipStatus } from '@platform/shared';
import type { SessionUserDTO } from '@platform/shared';

import { buildHesabimMenu } from './staffMenu';

/**
 * Whether the person who just signed in with a PIN may take the tablet out
 * of kiosk mode: an active membership in the kiosk's studio whose
 * permissions show the kiosk entry in the staff menu (the same permission
 * that pairs a kiosk). A member's PIN never unlocks the kiosk.
 */
export function canExitKiosk(user: Pick<SessionUserDTO, 'memberships'>, kioskStudioId: string): boolean {
  const membership = user.memberships.find((m) => m.studioId === kioskStudioId && m.status === MembershipStatus.ACTIVE);
  if (!membership) return false;
  const menu = buildHesabimMenu({
    permissions: membership.permissions,
    isMember: Boolean(membership.memberProfileId),
    isTrainer: Boolean(membership.trainerProfileId),
  });
  return menu.some((item) => item.key === 'kiosk');
}
