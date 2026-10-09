import { MembershipStatus } from '@platform/shared';
import type { MembershipDTO, PermissionKey } from '@platform/shared';

import { canExitKiosk } from './kioskExit';

function membership(studioId: string, permissions: PermissionKey[], overrides: Partial<MembershipDTO> = {}): MembershipDTO {
  return {
    id: `m-${studioId}`,
    studioId,
    status: MembershipStatus.ACTIVE,
    permissions,
    memberProfileId: null,
    trainerProfileId: null,
    isOwner: false,
    ...overrides,
  } as MembershipDTO;
}

describe('canExitKiosk', () => {
  it('refuses a member PIN', () => {
    const user = { memberships: [membership('s1', [], { memberProfileId: 'p1' })] };
    expect(canExitKiosk(user, 's1')).toBe(false);
  });

  it('refuses staff without the kiosk permission', () => {
    const user = { memberships: [membership('s1', ['attendance.manage', 'members.view'])] };
    expect(canExitKiosk(user, 's1')).toBe(false);
  });

  it('allows staff who may manage the kiosk in this studio', () => {
    const user = { memberships: [membership('s1', ['studio.settings.manage'])] };
    expect(canExitKiosk(user, 's1')).toBe(true);
  });

  it('ignores the permission held in another studio', () => {
    const user = { memberships: [membership('s2', ['studio.settings.manage']), membership('s1', [], { memberProfileId: 'p1' })] };
    expect(canExitKiosk(user, 's1')).toBe(false);
  });

  it('ignores a membership that is not active', () => {
    const user = { memberships: [membership('s1', ['studio.settings.manage'], { status: MembershipStatus.INVITED })] };
    expect(canExitKiosk(user, 's1')).toBe(false);
  });
});
