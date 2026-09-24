import type { PartnerVisitsReportRow } from '@platform/shared';
import { toCsv } from '../../common/csv';

export function partnerVisitsToCsv(rows: readonly PartnerVisitsReportRow[]): string {
  const cells = rows.map((r) => [r.provider, r.connectionLabel, r.month, r.visits, r.noShows, r.expectedPayout]);
  return toCsv(['Sağlayıcı', 'Bağlantı', 'Ay', 'Ziyaret', 'Gelmeme', 'Beklenen Ödeme'], cells);
}
