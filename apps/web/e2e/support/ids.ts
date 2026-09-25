/**
 * Test data created through the UI must not collide across spec files that
 * may run in parallel workers against the same seeded database, and must
 * stay identifiable for manual cleanup if a run is interrupted. Every
 * created record's name carries one of these suffixes.
 */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
