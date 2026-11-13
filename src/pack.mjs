// SPDX-License-Identifier: MIT
/**
 * pack.mjs - one judgement pack, read by both implementations.
 *
 * The registry used to exist twice: inline constants in `verdict.mjs` and two JSON files
 * next to the Python gate. Nothing compared them, and the cross-check compares verdicts on
 * a handful of samples, so a name added on one side only could still pass everything.
 * A single file with an explicit schema removes that class of drift.
 *
 * The pack carries data, never logic: `rules` only selects which rules run. The moment a
 * pack starts describing how a rule works, it has become a rule engine - which is a
 * different, much larger decision (see .out-of-scope/vendor-state-machines.md).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PACK_SCHEMA_VERSION = 1
const KNOWN_RULES = new Set(['R1', 'R2', 'R3', 'R4', 'R5', 'R6'])
const KNOWN_STATUSES = new Set([
  'active',
  'active_with_caveat',
  'deprecated_as_sole_criterion',
  'LIVE',
  'DEAD',
  'UNKNOWN',
  'TESTED_WEAK',
])

export function defaultPackPath() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'packs', 'evidence-for-capability-claims.json')
}

function fail(key, want, got) {
  throw new TypeError('dot-gate pack: ' + key + ' must be ' + want + ' (got ' + JSON.stringify(got) + ')')
}

/** Throw with the offending key rather than failing somewhere deep in a rule. */
export function validatePack(pack) {
  if (pack === undefined || pack === null || typeof pack !== 'object') fail('pack', 'an object', pack)
  if (pack.schemaVersion !== PACK_SCHEMA_VERSION) fail('schemaVersion', String(PACK_SCHEMA_VERSION), pack.schemaVersion)
  if (typeof pack.name !== 'string' || pack.name.length === 0) fail('name', 'a non-empty string', pack.name)
  if (!Array.isArray(pack.paths) || pack.paths.some((p) => typeof p !== 'string')) fail('paths', 'an array of strings', pack.paths)
  if (!Array.isArray(pack.words) || pack.words.some((w) => typeof w !== 'string' || w.length === 0)) fail('words', 'an array of non-empty strings', pack.words)
  if (pack.thresholds === undefined || pack.thresholds === null || typeof pack.thresholds !== 'object') fail('thresholds', 'an object', pack.thresholds)
  if (!Number.isInteger(pack.thresholds.minSources) || pack.thresholds.minSources < 1) fail('thresholds.minSources', 'a positive integer', pack.thresholds.minSources)
  if (!Number.isInteger(pack.thresholds.minRuns) || pack.thresholds.minRuns < 1) fail('thresholds.minRuns', 'a positive integer', pack.thresholds.minRuns)
  if (!Array.isArray(pack.rules) || pack.rules.some((r) => !KNOWN_RULES.has(r))) fail('rules', 'an array drawn from ' + [...KNOWN_RULES].join('/'), pack.rules)
  for (const key of ['metrics', 'liveVars']) {
    const table = pack[key]
    if (table === undefined || table === null || typeof table !== 'object') fail(key, 'an object', table)
    for (const [entry, value] of Object.entries(table)) {
      if (value === null || typeof value !== 'object') fail(key + '.' + entry, 'an object with a status', value)
      if (!KNOWN_STATUSES.has(value.status)) fail(key + '.' + entry + '.status', 'one of ' + [...KNOWN_STATUSES].join('/'), value.status)
    }
  }
  return pack
}

export function loadPack(path) {
  const target = path === undefined || path === null || path === '' ? defaultPackPath() : path
  const raw = readFileSync(target, 'utf8')
  return { pack: validatePack(JSON.parse(raw)), path: target }
}
