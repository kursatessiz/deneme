module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },
  testEnvironment: 'node',
  testTimeout: 30000,
  // These tests hit a real Postgres and rely on transactional counters
  // (bookings, package unit balances). Running specs one at a time keeps
  // the shared seed data deterministic across the whole suite.
  maxWorkers: 1,
  // In-band means one process boots a Nest application per spec file and
  // the heap grows with the number of files; the test:e2e script therefore
  // raises Node's heap limit (see package.json).
};
