import type { PartnerVisitsReportRow } from '@platform/shared';
import { toCsv } from '../../common/csv';
import { requestT } from '../../common/server-i18n';
import type { ServerT } from '../../common/server-i18n';

/** Headers follow the language of the request. */
export function partnerVisitsToCsv(rows: readonly PartnerVisitsReportRow[], t: ServerT = requestT()): string {
  const cells = rows.map((r) => [r.provider, r.connectionLabel, r.month, r.visits, r.noShows, r.expectedPayout]);
  return toCsv(
    [t('apiTexts.csv.provider'), t('apiTexts.csv.connection'), t('apiTexts.csv.month'), t('apiTexts.csv.visits'), t('apiTexts.csv.partnerNoShows'), t('apiTexts.csv.expectedPayout')],
    cells,
  );
}
