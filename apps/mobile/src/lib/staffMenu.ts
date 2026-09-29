import type { PermissionKey } from '@platform/shared';

export interface MenuItem {
  key: string;
  /** A messages/mAccount.ts key ("mAccount.menu.<key>"); hesabim/index.tsx translates it. */
  labelKey: string;
  route: string;
}

export interface StaffMenuInput {
  permissions: PermissionKey[];
  isMember: boolean;
  isTrainer: boolean;
}

function has(permissions: PermissionKey[], key: PermissionKey): boolean {
  return permissions.includes(key);
}

/**
 * Builds the Hesabım menu from the active membership's permission set, so
 * navigation stays permission-driven (CLAUDE.md "Mobil uygulama kuralları")
 * rather than role-name-driven. Pure and unit-testable; hesabim/index.tsx
 * only handles rendering and onPress wiring.
 */
export function buildHesabimMenu(input: StaffMenuInput): MenuItem[] {
  const { permissions, isMember, isTrainer } = input;
  const items: MenuItem[] = [];

  items.push({ key: 'notifications', labelKey: 'mAccount.menu.notifications', route: '/(app)/hesabim/bildirimler' });
  items.push({ key: 'calendar-sub', labelKey: 'mAccount.menu.calendarSub', route: '/(app)/hesabim/takvim' });
  items.push({ key: 'pin', labelKey: 'mAccount.menu.pin', route: '/(app)/hesabim/pin' });
  items.push({ key: 'appearance', labelKey: 'mAccount.menu.appearance', route: '/(app)/hesabim/gorunum' });
  items.push({ key: 'language', labelKey: 'mAccount.menu.language', route: '/(app)/hesabim/dil' });

  if (isMember) {
    items.push({ key: 'home-branch', labelKey: 'mAccount.menu.homeBranch', route: '/(app)/hesabim/ana-sube' });
    items.push({ key: 'my-payments', labelKey: 'mAccount.menu.myPayments', route: '/(app)/hesabim/odemelerim' });
    items.push({ key: 'my-achievements', labelKey: 'mAccount.menu.myAchievements', route: '/(app)/hesabim/basarilarim' });
    items.push({ key: 'my-points', labelKey: 'mAccount.menu.myPoints', route: '/(app)/hesabim/puanlarim' });
    items.push({ key: 'events', labelKey: 'mAccount.menu.events', route: '/(app)/hesabim/etkinlikler' });
    items.push({ key: 'refer-friend', labelKey: 'mAccount.menu.referFriend', route: '/(app)/hesabim/arkadasini-getir' });
    items.push({ key: 'health', labelKey: 'mAccount.menu.health', route: '/(app)/hesabim/saglik' });
    items.push({ key: 'chat', labelKey: 'mAccount.menu.chat', route: '/(app)/hesabim/mesajlar' });
  }

  if (isTrainer && has(permissions, 'commissions.view.own')) {
    items.push({ key: 'my-commission', labelKey: 'mAccount.menu.myCommission', route: '/(app)/hesabim/hakedisim' });
  }
  if (has(permissions, 'commissions.view.all')) {
    items.push({ key: 'payroll', labelKey: 'mAccount.menu.payroll', route: '/(app)/hesabim/bordro' });
  }
  if (isMember) {
    items.push({ key: 'my-invoices', labelKey: 'mAccount.menu.myInvoices', route: '/(app)/hesabim/faturalarim' });
    items.push({ key: 'qr-check-in', labelKey: 'mAccount.menu.qrCheckIn', route: '/(app)/hesabim/qr-ile-giris' });
  }

  if (has(permissions, 'schedule.view') && isTrainer) {
    items.push({ key: 'my-schedule', labelKey: 'mAccount.menu.mySchedule', route: '/(app)/hesabim/programim' });
  }
  if (has(permissions, 'attendance.manage') || has(permissions, 'bookings.manage')) {
    items.push({ key: 'today-sessions', labelKey: 'mAccount.menu.todaySessions', route: '/(app)/hesabim/bugun' });
  }
  if (has(permissions, 'members.view')) {
    items.push({ key: 'members', labelKey: 'mAccount.menu.members', route: '/(app)/hesabim/uyeler' });
  }
  if (has(permissions, 'members.manage')) {
    items.push({ key: 'new-member', labelKey: 'mAccount.menu.newMember', route: '/(app)/hesabim/uyeler/yeni' });
  }
  if (has(permissions, 'schedule.manage')) {
    items.push({ key: 'new-session', labelKey: 'mAccount.menu.newSession', route: '/(app)/hesabim/programim/yeni' });
  }
  if (has(permissions, 'events.checkin') && has(permissions, 'events.view')) {
    items.push({ key: 'event-check-in', labelKey: 'mAccount.menu.eventCheckIn', route: '/(app)/hesabim/etkinlik-girisi' });
  }
  if (has(permissions, 'attendance.manage')) {
    items.push({ key: 'member-qr-scan', labelKey: 'mAccount.menu.memberQrScan', route: '/(app)/hesabim/resepsiyon-tarama' });
  }
  if (has(permissions, 'studio.settings.manage')) {
    items.push({ key: 'kiosk', labelKey: 'mAccount.menu.kiosk', route: '/(app)/hesabim/kiosk-modu' });
  }
  if (has(permissions, 'retail.sell')) {
    items.push({ key: 'quick-sale', labelKey: 'mAccount.menu.quickSale', route: '/(app)/hesabim/hizli-satis' });
  }
  if (has(permissions, 'reports.view')) {
    items.push({ key: 'branch-summary', labelKey: 'mAccount.menu.branchSummary', route: '/(app)/hesabim/subeler' });
    items.push({ key: 'reports', labelKey: 'mAccount.menu.reports', route: '/(app)/hesabim/raporlar' });
    items.push({ key: 'risky-members', labelKey: 'mAccount.menu.riskyMembers', route: '/(app)/hesabim/riskli-uyeler' });
  }
  if (has(permissions, 'crm.view')) {
    items.push({ key: 'contacts', labelKey: 'mAccount.menu.contacts', route: '/(app)/hesabim/kisiler' });
  }
  if (has(permissions, 'inbox.view')) {
    items.push({ key: 'inbox', labelKey: 'mAccount.menu.inbox', route: '/(app)/hesabim/gelen-kutusu' });
  }
  if (has(permissions, 'leads.view')) {
    items.push({ key: 'leads', labelKey: 'mAccount.menu.leads', route: '/(app)/hesabim/potansiyel-uyeler' });
  }
  if (has(permissions, 'studio.settings.manage')) {
    items.push({ key: 'business-theme', labelKey: 'mAccount.menu.businessTheme', route: '/(app)/hesabim/isletme-temasi' });
  }
  if (has(permissions, 'notifications.manage')) {
    items.push({ key: 'automations', labelKey: 'mAccount.menu.automations', route: '/(app)/hesabim/otomatik-mesajlar' });
  }
  if (has(permissions, 'integrations.manage')) {
    items.push({ key: 'integrations', labelKey: 'mAccount.menu.integrations', route: '/(app)/hesabim/entegrasyonlar' });
  }
  if (has(permissions, 'integrations.partners.manage')) {
    items.push({ key: 'partners', labelKey: 'mAccount.menu.partners', route: '/(app)/hesabim/partner-platformlar' });
  }
  if (has(permissions, 'content.manage')) {
    items.push({ key: 'video-content', labelKey: 'mAccount.menu.videoContent', route: '/(app)/hesabim/video-icerikleri' });
  }

  return items;
}
