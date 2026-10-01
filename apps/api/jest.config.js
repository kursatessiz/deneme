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
  // ts-jest workers grow with every spec file they compile; recycle a worker
  // once it idles above this limit instead of letting it hit Node's heap cap.
  workerIdleMemoryLimit: '1GB',
};
