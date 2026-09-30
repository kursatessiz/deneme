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
  // The suite boots a Nest application per spec file; with dozens of files
  // the single in-band process outgrows Node's default heap on CI. Setting an
  // idle memory limit makes Jest run the one worker out of process and
  // recycle it once it exceeds the limit, which keeps the run serial while
  // releasing memory between spec files.
  workerIdleMemoryLimit: '1536MB',
};
