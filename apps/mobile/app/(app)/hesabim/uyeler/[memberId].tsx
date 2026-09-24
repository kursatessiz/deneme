import { useLocalSearchParams } from 'expo-router';
import React from 'react';

import { MemberCard } from '../../../../src/components/MemberCard';
import { PermissionGate } from '../../../../src/components/PermissionGate';
import { ScreenContainer } from '../../../../src/components/ScreenContainer';

/** Phone stack target for the member card; tablet renders MemberCard inline instead. */
export default function UyeKartiScreen() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();

  return (
    <PermissionGate anyOf={['members.view']}>
      <ScreenContainer>
        <MemberCard memberId={memberId} />
      </ScreenContainer>
    </PermissionGate>
  );
}
