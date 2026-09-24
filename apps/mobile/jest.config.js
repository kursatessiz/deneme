/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Only pure TypeScript helpers are unit-tested here (no react-native
  // renderer/jest-expo): screens and components stay covered by
  // typecheck plus manual/E2E verification, matching apps/web's pattern.
  testMatch: ['**/src/**/*.spec.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },
};
