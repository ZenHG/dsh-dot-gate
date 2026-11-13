// SPDX-License-Identifier: MIT
/**
 * pack.mjs - one judgement pack, read by both implementations.
 *
 * The registry used to exist twice, with nothing comparing them. A single file with an
 * explicit schema removes that class of drift.
 *
 * The pack carries composition, not logic: `rules` composes atoms from a closed vocabulary.
 * Naming an atom the interpreter does not know is a load-time error, never a silent no-op.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ATOMS, OVER_PATHS } from './evaluate.mjs'

export const PACK_SCHEMA_VERSION = 2
const WHEN = new Set(['always', 'negative', 'non-negative'])
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
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'packs', 'generic.json')
}

const EVIDENCE_ATOM = 'sources>=minSources'

/**
 * A pack that declares an evidence floor it never composes enforces nothing:
 * minSources is mandatory, so a pack without this rule states a floor and then
 * never applies it, and an empty verdict passes. A check with `over` is a loop
 * over a collection, which is vacuous when the collection is empty, so it does
 * not count. A check scoped by `when` does count - it still applies to the
 * claims the pack speaks about.
 */
function composesEvidenceFloor(rules) {
  return Object.values(rules).some(
    (rule) => Array.isArray(rule.checks) && rule.checks.some((check) => check.atom === EVIDENCE_ATOM && check.over === undefined),
  )
}

function fail(key, want, got) {
  throw new TypeError('dot-gate pack: ' + key + ' must be ' + want + ' (got ' + JSON.stringify(got) + ')')
}

function validateSection(name, section) {
  if (section === undefined || section === null) return
  if (typeof section !== 'object') fail(name, 'an object of rules', section)
  for (const [ruleId, rule] of Object.entries(section)) {
    if (rule === null || typeof rule !== 'object') fail(name + '.' + ruleId, 'an object', rule)
    if (rule.when !== undefined && !WHEN.has(rule.when)) fail(name + '.' + ruleId + '.when', 'one of ' + [...WHEN].join('/'), rule.when)
    if (!Array.isArray(rule.checks) || rule.checks.length === 0) fail(name + '.' + ruleId + '.checks', 'a non-empty array', rule.checks)
    for (const [i, check] of rule.checks.entries()) {
      const at = name + '.' + ruleId + '.checks.' + i
      if (check === null || typeof check !== 'object') fail(at, 'an object', check)
      if (!ATOMS.has(check.atom)) fail(at + '.atom', 'one of ' + [...ATOMS].join('/'), check.atom)
      if (check.over !== undefined && !OVER_PATHS.has(check.over)) fail(at + '.over', 'one of ' + [...OVER_PATHS].join('/'), check.over)
    }
  }
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
  validateSection('rules', pack.rules)
  validateSection('warnings', pack.warnings)
  if (pack.rules === undefined) fail('rules', 'an object of rules', pack.rules)
  if (!composesEvidenceFloor(pack.rules)) {
    throw new TypeError(
      'dot-gate pack: rules must compose ' + EVIDENCE_ATOM + ' without over; thresholds.minSources is ' +
        pack.thresholds.minSources + ' but no rule applies it, so a verdict with no sources would pass' +
        ' (got rules: ' + Object.keys(pack.rules).join(', ') + ')',
    )
  }
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
  return { pack: validatePack(JSON.parse(readFileSync(target, 'utf8'))), path: target }
}
