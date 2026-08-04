/** @type {import('ts-jest').JestConfigWithTsJest} */
// SEPARATE from the default apps/api/jest.config.js (which drives `pnpm test`
// and must stay DB/Docker/network-free for CI). This config drives ONLY
// `pnpm --filter @verdict/api test:e2e`, which boots the real Nest app
// against a real Postgres + Docker sandbox — see test/e2e/README below the
// package.json `test:e2e` script for how to run it.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '../..',
  roots: ['<rootDir>/test/e2e'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // `.e2e-spec.ts`, NOT `.spec.ts` — the default jest.config.js's testRegex
  // (`.*\.(spec|test)\.ts$`) does not match this suffix, so these files are
  // never picked up by the default `pnpm test`.
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  // Real grading through the Docker sandbox (harness spin-up, per-case
  // timeouts) and the LangGraph AI draft pipeline are slower than pure unit
  // tests; one correct submission alone can take several seconds.
  testTimeout: 120_000,
};
