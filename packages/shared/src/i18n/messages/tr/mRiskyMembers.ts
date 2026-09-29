/** Mobile app: Hesabım > Riskli üyeler (churn-risk list with a quick "contacted" action). */
export const trMRiskyMembers = {
  'mRiskyMembers.level.high': 'Yüksek',
  'mRiskyMembers.level.medium': 'Orta',
  'mRiskyMembers.level.low': 'Düşük',
  'mRiskyMembers.neverAttended': 'Hiç gelmedi',
  'mRiskyMembers.caption': 'Yüksek ve orta riskli üyeler',
  'mRiskyMembers.noRiskyMembers': 'Riskli üye bulunmuyor.',
  'mRiskyMembers.levelScore': '{level} - {score}',
  'mRiskyMembers.lastAttended': 'Son katılım: {date}',
  'mRiskyMembers.a11y.markContacted': '{name} ile görüşüldü olarak işaretle',
  'mRiskyMembers.contactedToday': 'Bugün görüşüldü',
  'mRiskyMembers.markContacted': 'Görüşüldü',
  'mRiskyMembers.defaultContactNote': 'Telefonla görüşüldü',
  'mRiskyMembers.errors.loadFailed': 'Riskli üyeler yüklenemedi.',
  'mRiskyMembers.errors.markContactedFailed': 'Görüşüldü olarak işaretlenemedi.',
} as const satisfies Record<string, string>;
