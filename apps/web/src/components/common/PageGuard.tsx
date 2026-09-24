'use client';

import type { PermissionKey } from '@platform/shared';
import { hasAnyPermission } from '@/lib/nav';
import { useDashboardSession } from '@/components/session/DashboardSessionProvider';
import { Forbidden } from '@/components/common/Forbidden';

/** Wraps a dashboard page's content, rendering the 403 view when the active membership lacks every required permission. */
export function PageGuard({ required, children }: { required: readonly PermissionKey[]; children: React.ReactNode }) {
  const { permissions, isOwner } = useDashboardSession();
  if (!hasAnyPermission(required, permissions, isOwner)) return <Forbidden />;
  return <>{children}</>;
}
