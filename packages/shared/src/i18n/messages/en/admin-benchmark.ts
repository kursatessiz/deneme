import type { trAdminBenchmark } from '../tr/admin-benchmark';

export const enAdminBenchmark = {
  'adminBenchmark.title': 'Benchmark',
  'adminBenchmark.subtitle': 'Anonymized averages by business type. Groups with fewer than 5 tenants are hidden.',
  'adminBenchmark.accessDenied': 'No access',
  'adminBenchmark.studioCount': '{count} tenants',
  'adminBenchmark.suppressed': 'Not enough tenants (at least 5 required) - data hidden',
  'adminBenchmark.occupancy': 'Occupancy rate: {value}',
  'adminBenchmark.cancellation': 'Cancellation rate: {value}',
  'adminBenchmark.revenuePerMember': 'Revenue per member: {value}',
  'adminBenchmark.revenuePerMemberValue': '{amount} TRY',
  'adminBenchmark.renewal': 'Renewal rate: {value}',
} as const satisfies Record<keyof typeof trAdminBenchmark, string>;
