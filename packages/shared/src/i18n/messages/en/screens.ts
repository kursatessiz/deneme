import type { trScreens } from '../tr/screens';

/** English text for the `screens.*` namespace. Keep keys in sync with tr/screens.ts. */
export const enScreens = {
  'screens.trainers.title': 'Trainers',
  'screens.trainers.subtitle': 'Trainers on staff',
  'screens.trainers.empty.title': 'No trainers yet',
  'screens.trainers.empty.description': 'Staff will be listed here as they are invited.',
  'screens.trainers.noBio': 'No description added',
  'screens.trainers.qualifiedCount.one': 'Qualified for {count} service type',
  'screens.trainers.qualifiedCount.other': 'Qualified for {count} service types',

  'screens.attendance.title': "Today's Attendance",
  'screens.attendance.subtitle': 'Quick check-in list for the front desk',
  'screens.attendance.errors.loadFailed': "Today's sessions could not be loaded",
  'screens.attendance.empty': 'No session is scheduled today',
  'screens.attendance.noTrainer': 'No trainer assigned',
  'screens.attendance.noBookings': 'No bookings.',
  'screens.attendance.checkIn': 'Check in',
  'screens.attendance.status.ATTENDED': 'Attended',
  'screens.attendance.status.NO_SHOW': 'No-show',

  'screens.dashboard.title': 'Overview',
  'screens.dashboard.subtitle': "Your business's current status",
  'screens.dashboard.empty.title': 'No data yet',
  'screens.dashboard.empty.description': 'Branch and session data will be summarized here as it comes in.',
  'screens.dashboard.noAddress': 'No address defined',
  'screens.dashboard.quickActions.title': 'Quick actions',
  'screens.dashboard.quickActions.newSession': 'New session',
  'screens.dashboard.quickActions.newMember': 'New member',
  'screens.dashboard.quickActions.sellPackage': 'Sell package',
  'screens.dashboard.quickActions.recordPayment': 'Record payment',
  'screens.dashboard.quickActions.checkIn': 'Check in',
  'screens.dashboard.quickActions.quickSale': 'Quick sale',
} as const satisfies Record<keyof typeof trScreens, string>;
