import type { ChurnMemberSummaryDTO } from '@platform/shared';
import { toCsv } from '../../common/csv';

const LEVEL_LABEL: Record<string, string> = { LOW: 'Düşük', MEDIUM: 'Orta', HIGH: 'Yüksek' };

export function churnMembersToCsv(items: readonly ChurnMemberSummaryDTO[]): string {
  const rows = items.map((m) => [
    `${m.firstName} ${m.lastName}`,
    m.phone ?? '',
    LEVEL_LABEL[m.level] ?? m.level,
    m.score,
    m.previousScore ?? '',
    m.onboarding ? 'Evet' : 'Hayır',
    m.lastAttendedAt ?? '',
    m.activePackageEndDate ?? '',
    m.reasons.map((r) => r.label).join(' / '),
    m.contactedAt ?? '',
  ]);
  return toCsv(
    ['Ad Soyad', 'Telefon', 'Risk seviyesi', 'Puan', 'Önceki puan', 'Yeni üye', 'Son katılım', 'Paket bitişi', 'Nedenler', 'Görüşüldü'],
    rows,
  );
}
