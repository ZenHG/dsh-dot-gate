// SPDX-License-Identifier: MIT
/**
 * stryker.config.mjs - mutation testing for the judgement-pack interpreter.
 *
 * This suite runs on the built-in node:test runner, so there is no dedicated
 * Stryker plugin for it. The generic command runner covers it: it does not know
 * how many tests ran, it only reads the exit code, which is exactly the contract
 * `node --test` already honours (0 = all pass, non-zero = at least one failed).
 *
 * The scope is the decision logic, not the host glue: evaluate.mjs and pack.mjs
 * decide whether a verdict passes, verdict.mjs delegates, and index.js turns a hit
 * into a reminder. Those four are the surface a defect would have to cross.
 */
export default {
  testRunner: 'command',
  commandRunner: {
    command: 'node --test test.mjs test-verdict.mjs test-pack.mjs',
  },
  mutate: ['src/evaluate.mjs', 'src/pack.mjs', 'src/verdict.mjs', 'index.js'],
  coverageAnalysis: 'off',
  concurrency: 4,
  timeoutMS: 20000,
  reporters: ['clear-text', 'json'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
}
