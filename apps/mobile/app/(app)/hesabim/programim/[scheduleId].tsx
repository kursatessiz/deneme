import { useLocalSearchParams } from 'expo-router';
import React from 'react';

import { PermissionGate } from '../../../../src/components/PermissionGate';
import { ScreenContainer } from '../../../../src/components/ScreenContainer';
import { SessionDetail } from '../../../../src/components/SessionDetail';

/** Phone stack target for a session's roster/check-in; tablet renders SessionDetail inline instead. */
export default function ProgramimDetailScreen() {
  const { scheduleId, startTime } = useLocalSearchParams<{ scheduleId: string; startTime?: string }>();

  return (
    <PermissionGate anyOf={['schedule.view']}>
      <ScreenContainer>
        <SessionDetail scheduleId={scheduleId} hintStartTime={startTime} />
      </ScreenContainer>
    </PermissionGate>
  );
}
