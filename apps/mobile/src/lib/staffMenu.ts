import type { PermissionKey } from '@platform/shared';

export interface MenuItem {
  key: string;
  label: string;
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

  items.push({ key: 'notifications', label: 'Bildirim ayarları', route: '/(app)/hesabim/bildirimler' });
  items.push({ key: 'calendar-sub', label: 'Takvim aboneliği', route: '/(app)/hesabim/takvim' });
  items.push({ key: 'pin', label: 'PIN değiştir', route: '/(app)/hesabim/pin' });
  items.push({ key: 'appearance', label: 'Görünüm', route: '/(app)/hesabim/gorunum' });

  if (isMember) {
    items.push({ key: 'home-branch', label: 'Ana şubem', route: '/(app)/hesabim/ana-sube' });
    items.push({ key: 'my-payments', label: 'Ödemelerim', route: '/(app)/hesabim/odemelerim' });
    items.push({ key: 'my-achievements', label: 'Başarılarım', route: '/(app)/hesabim/basarilarim' });
    items.push({ key: 'refer-friend', label: 'Arkadaşını getir', route: '/(app)/hesabim/arkadasini-getir' });
    items.push({ key: 'health', label: 'Sağlık entegrasyonu', route: '/(app)/hesabim/saglik' });
  }

  if (isTrainer && has(permissions, 'commissions.view.own')) {
    items.push({ key: 'my-commission', label: 'Hakedişim', route: '/(app)/hesabim/hakedisim' });
  }
  if (has(permissions, 'commissions.view.all')) {
    items.push({ key: 'payroll', label: 'Bordro', route: '/(app)/hesabim/bordro' });
  }
  if (isMember) {
    items.push({ key: 'my-invoices', label: 'Faturalarım', route: '/(app)/hesabim/faturalarim' });
    items.push({ key: 'qr-check-in', label: 'QR ile giriş', route: '/(app)/hesabim/qr-ile-giris' });
  }

  if (has(permissions, 'schedule.view') && isTrainer) {
    items.push({ key: 'my-schedule', label: 'Programım', route: '/(app)/hesabim/programim' });
  }
  if (has(permissions, 'attendance.manage') || has(permissions, 'bookings.manage')) {
    items.push({ key: 'today-sessions', label: 'Bugünün seansları', route: '/(app)/hesabim/bugun' });
  }
  if (has(permissions, 'members.view')) {
    items.push({ key: 'members', label: 'Üyeler', route: '/(app)/hesabim/uyeler' });
  }
  if (has(permissions, 'members.manage')) {
    items.push({ key: 'new-member', label: 'Yeni üye davet et', route: '/(app)/hesabim/uyeler/yeni' });
  }
  if (has(permissions, 'schedule.manage')) {
    items.push({ key: 'new-session', label: 'Yeni seans', route: '/(app)/hesabim/programim/yeni' });
  }
  if (has(permissions, 'attendance.manage')) {
    items.push({ key: 'member-qr-scan', label: 'Üye QR tarama', route: '/(app)/hesabim/resepsiyon-tarama' });
  }
  if (has(permissions, 'studio.settings.manage')) {
    items.push({ key: 'kiosk', label: 'Kiosk modu', route: '/(app)/hesabim/kiosk-modu' });
  }
  if (has(permissions, 'reports.view')) {
    items.push({ key: 'branch-summary', label: 'Şube özeti', route: '/(app)/hesabim/subeler' });
    items.push({ key: 'reports', label: 'Raporlar', route: '/(app)/hesabim/raporlar' });
    items.push({ key: 'risky-members', label: 'Riskli üyeler', route: '/(app)/hesabim/riskli-uyeler' });
  }
  if (has(permissions, 'leads.view')) {
    items.push({ key: 'leads', label: 'Potansiyel üyeler', route: '/(app)/hesabim/potansiyel-uyeler' });
  }
  if (has(permissions, 'studio.settings.manage')) {
    items.push({ key: 'business-theme', label: 'İşletme teması', route: '/(app)/hesabim/isletme-temasi' });
  }
  if (has(permissions, 'notifications.manage')) {
    items.push({ key: 'automations', label: 'Otomatik mesajlar', route: '/(app)/hesabim/otomatik-mesajlar' });
  }
  if (has(permissions, 'integrations.manage')) {
    items.push({ key: 'integrations', label: 'Entegrasyonlar', route: '/(app)/hesabim/entegrasyonlar' });
  }
  if (has(permissions, 'integrations.partners.manage')) {
    items.push({ key: 'partners', label: 'Partner platformlar', route: '/(app)/hesabim/partner-platformlar' });
  }
  if (has(permissions, 'content.manage')) {
    items.push({ key: 'video-content', label: 'Video içerikleri', route: '/(app)/hesabim/video-icerikleri' });
  }

  return items;
}
