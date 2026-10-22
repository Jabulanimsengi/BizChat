module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
  coverageDirectory: 'coverage',
  // A regression floor, not a target. Real behaviour is additionally covered by the
  // real-stack smoke harnesses and the HTTP integration suite.
  coverageThreshold: {
    global: { statements: 20, branches: 20, functions: 15, lines: 20 },
  },
};
