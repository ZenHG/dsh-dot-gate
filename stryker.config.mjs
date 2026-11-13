// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs'
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
// The command is read from package.json rather than repeated here: a hard-coded list once
// left the property suite out, so every mutant was scored against two thirds of the tests.
// Anything npm test runs is what a mutant has to survive.
const { scripts } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default {
  testRunner: 'command',
  commandRunner: {
    command: scripts.test,
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
