module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  // ts-jest workers grow with every spec file they compile; the test script
  // raises Node's heap limit (inherited by the workers) instead of recycling
  // workers, which restarted them after nearly every file on CI.
};
