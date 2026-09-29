import type { trMHealth } from '../tr/mHealth';

export const enMHealth: Record<keyof typeof trMHealth, string> = {
  'mHealth.errors.settingsLoadFailed': 'Health settings could not be loaded.',
  'mHealth.errors.consentSaveFailed': 'Consent could not be saved.',
  'mHealth.errors.consentRequired': 'You must first give consent to share health data.',
  'mHealth.errors.settingSaveFailed': 'Setting could not be saved.',
  'mHealth.errors.dataDeleteFailed': 'Data could not be deleted.',
  'mHealth.lead':
    'You can share sessions you attended, and if you like your daily steps, active energy and resting heart rate, with this app through Apple Health or Health Connect. Health data is special-category personal data: nothing is shared without your explicit consent, and it can be fully deleted at any time.',
  'mHealth.consent.title': 'Consent',
  'mHealth.consent.granted': 'You have consented to sharing health data.',
  'mHealth.consent.notGranted': 'To turn on these settings, you must first accept the health-data sharing consent text.',
  'mHealth.consent.accept': 'I consent',
  'mHealth.writeWorkouts.title': 'Write my sessions to health',
  'mHealth.writeWorkouts.description':
    'When a session you attended ends, the session type and duration (calories, if entered) are written to your device health app as a workout. The same session is never written twice.',
  'mHealth.readAggregates.title': 'Read step and heart-rate data',
  'mHealth.readAggregates.description':
    'Your daily step, active energy and resting heart rate summaries are shown only on your device, on your "Health" screen.',
  'mHealth.shareWithStudio.title': 'Share with the studio',
  'mHealth.shareWithStudio.description':
    'A separate consent: if turned on, your daily summaries (never raw data) are shared with your studio, and your trainer can see the trend on your member card. This setting only works while "Read step and heart-rate data" is on.',
  'mHealth.toggleOn': 'On',
  'mHealth.viewHealthScreen': 'View my health screen',
  'mHealth.deleteData.title': 'Delete my data',
  'mHealth.deleteData.description':
    'All health data stored on the server (daily summaries and sync records) is permanently deleted, all settings are turned off, and your consent is withdrawn. Data in your device\'s own health app is not affected by this action.',
  'mHealth.deleteData.confirm': 'Are you sure? This action cannot be undone.',
  'mHealth.deleteData.confirmYes': 'Yes, delete my data',
  'mHealth.deleteData.cancel': 'Cancel',
  'mHealth.deleteData.action': 'Delete my data',
  'mHealth.trend.title': 'Health trend',
  'mHealth.trend.notShared': 'The member has not chosen to share health data with the studio.',
  'mHealth.trend.noDataYet': 'No data yet.',
  'mHealth.trend.avgSteps7Days': 'Avg. steps (7 days)',
  'mHealth.trend.lastRestingHeartRate': 'Latest resting heart rate',
  'mHealth.errors.trendLoadFailed': 'Health data could not be loaded.',
  'mHealth.a11y.lastNDays': 'Last {days} days',
  'mHealth.lastNDays': 'Last {days} days',
  'mHealth.noDataSharedYet': 'No health data shared yet. You can turn it on from Account > Health integration.',
  'mHealth.steps': 'Steps',
  'mHealth.activeEnergyKcal': 'Active energy (kcal)',
  'mHealth.restingHeartRate': 'Resting heart rate',
  'mHealth.errors.summariesLoadFailed': 'Health data could not be loaded.',
};
