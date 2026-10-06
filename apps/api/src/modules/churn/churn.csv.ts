import type { ChurnMemberSummaryDTO } from '@platform/shared';
import { toCsv } from '../../common/csv';
import { requestT } from '../../common/server-i18n';
import type { ServerT } from '../../common/server-i18n';

/** Headers, risk levels, yes/no and reason texts follow the language of the request. */
export function churnMembersToCsv(items: readonly ChurnMemberSummaryDTO[], t: ServerT = requestT()): string {
  const levelLabel = (level: string): string => (level === 'LOW' || level === 'MEDIUM' || level === 'HIGH' ? t(`churn.level.${level}`) : level);
  const rows = items.map((m) => [
    `${m.firstName} ${m.lastName}`,
    m.phone ?? '',
    levelLabel(m.level),
    m.score,
    m.previousScore ?? '',
    m.onboarding ? t('apiTexts.csv.yes') : t('apiTexts.csv.no'),
    m.lastAttendedAt ?? '',
    m.activePackageEndDate ?? '',
    m.reasons.map((r) => t(`churn.reason.${r.key}`)).join(' / '),
    m.contactedAt ?? '',
  ]);
  return toCsv(
    [
      t('apiTexts.csv.fullName'),
      t('apiTexts.csv.phone'),
      t('apiTexts.csv.riskLevel'),
      t('apiTexts.csv.score'),
      t('apiTexts.csv.previousScore'),
      t('apiTexts.csv.newMember'),
      t('apiTexts.csv.lastAttended'),
      t('apiTexts.csv.packageEnd'),
      t('apiTexts.csv.reasons'),
      t('apiTexts.csv.contacted'),
    ],
    rows,
  );
}
