#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * gen-pack.mjs - turn a short domain description into a reviewable judgement-pack draft.
 *
 * The generator owns the mechanics: it copies the package's default rule composition,
 * fills in the domain registries and thresholds, writes evidence fixtures, evaluates
 * every fixture against the pack it is about to write, and hands a human one pack plus
 * one checklist. It never authors a rule and never invents an atom.
 *
 * Exit codes: 0 emitted, 1 usage error, 2 refused (invalid or out-of-vocabulary).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { ATOMS, evaluate } from '../src/evaluate.mjs'
import { loadPack, validatePack } from '../src/pack.mjs'

class UsageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UsageError'
    this.exitCode = 1
  }
}

class Refusal extends Error {
  constructor(message, options) {
    super(message)
    this.name = 'Refusal'
    this.exitCode = 2
    this.wroteOutput = options !== undefined && options.wroteOutput === true
  }
}

class SelftestFailure extends Error {
  constructor(message) {
    super(message)
    this.name = 'SelftestFailure'
  }
}

const USAGE = [
  'gen-pack.mjs - domain description -> reviewable judgement-pack draft',
  '',
  'Usage:',
  '  node scripts/gen-pack.mjs --from <description.json> --out <dir> [--force]',
  '  node scripts/gen-pack.mjs --selftest',
  '  node scripts/gen-pack.mjs --help',
  '',
  'Input (a JSON object a person can write in five minutes):',
  '  domain         required; short name; the pack name and file name derive from it',
  '  description    required; what claims this domain makes',
  '  quantities     required; [{ name, measures, standing }]',
  '                 standing: active | caveat | deprecated',
  '  liveVars       required; [{ name, why, status }]',
  '                 status: LIVE | DEAD | UNKNOWN | TESTED_WEAK',
  '  evidenceFloor  required; { minSources, minRuns }, both positive integers',
  '  title          optional; defaults to domain',
  '  words          optional; trigger phrases; defaults to the packaged default pack',
  '  paths          optional; watched paths; defaults to the packaged default pack',
  '  checks         optional; atom names this domain expects the gate to cover',
  '',
  'checks is a coverage assertion, not a rule selector. Each entry must be one of the',
  'eight atoms the interpreter knows, and the generator confirms the default composition',
  'covers it. The generator never invents an atom and never removes a rule.',
  '',
  'Legal atoms (' + ATOMS.size + '): ' + [...ATOMS].join(', '),
  '',
  'Output (under --out):',
  '  packs/<name>.json    the draft pack, validated by src/pack.mjs before writing',
  '  samples/*.json       evidence fixtures, each evaluated against that pack',
  '  REVIEW.md            the accept/reject checklist',
  '',
  'Exit codes:',
  '  0 emitted (or --selftest passed)',
  '  1 usage error (bad arguments, unreadable/malformed input file, output exists)',
  '  2 refused (invalid description, out-of-vocabulary check, pack validation failure)',
].join('\n')

const INPUT_KEYS = new Set([
  'domain', 'title', 'description', 'words', 'paths', 'quantities', 'liveVars', 'evidenceFloor', 'checks',
])
const QUANTITY_KEYS = new Set(['name', 'measures', 'standing'])
const LIVEVAR_KEYS = new Set(['name', 'why', 'status'])
const FLOOR_KEYS = new Set(['minSources', 'minRuns'])

// Input spellings map onto the schema statuses. The mapping is data, not a second
// schema: validatePack still owns what a status is allowed to be.
const STANDING = new Map([
  ['active', 'active'],
  ['live', 'active'],
  ['caveat', 'active_with_caveat'],
  ['active_with_caveat', 'active_with_caveat'],
  ['deprecated', 'deprecated_as_sole_criterion'],
  ['deprecated_as_sole_criterion', 'deprecated_as_sole_criterion'],
])
const LIVE_STATUS = new Map([
  ['live', 'LIVE'],
  ['dead', 'DEAD'],
  ['unknown', 'UNKNOWN'],
  ['tested_weak', 'TESTED_WEAK'],
])

const RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
])

// Human wording for each atom. The keys are checked against ATOMS so a new atom
// cannot be silently composed into a draft without a reviewer-facing explanation.
const ATOM_HELP = {
  'sources>=minSources': function (thresholds) {
    return 'at least ' + thresholds.minSources + ' distinct source URLs'
  },
  'counter_search_done': function () {
    return 'a same-model positive search is recorded (done=true)'
  },
  'counter_search_clear': function () {
    return 'that search found 0 counter-examples (hits is not greater than 0)'
  },
  'metric_registered': function () {
    return 'every cited quantity is registered in metrics'
  },
  'metric_not_deprecated': function () {
    return 'no cited quantity is registered as deprecated_as_sole_criterion'
  },
  'var_live': function () {
    return 'every entry in verdict.contrast.diff_vars has status LIVE'
  },
  'repro_present': function () {
    return 'repro.cmd and repro.observed are both present'
  },
  'runs>=minRuns': function (thresholds) {
    return 'at least ' + thresholds.minRuns + ' runs'
  },
}

function message(error) {
  return error !== null && error !== undefined && typeof error.message === 'string' ? error.message : String(error)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function inline(value) {
  return String(value).replace(/\s+/g, ' ').trim()
}

function mdCell(value) {
  return inline(value).replace(/\|/g, '\\|')
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function checkKeys(value, allowed, at) {
  for (const key of Object.keys(value)) {
    if (key.startsWith('_')) continue
    if (!allowed.has(key)) {
      throw new Refusal(at + ' has unknown field "' + key + '"; allowed fields: ' + [...allowed].join(', '))
    }
  }
}

function requireString(value, key, at) {
  const item = value[key]
  if (typeof item !== 'string' || item.trim() === '') {
    throw new Refusal(at + '.' + key + ' must be a non-empty string')
  }
  return item.trim()
}

function optionalStringArray(value, key, at) {
  if (value[key] === undefined) return undefined
  const list = value[key]
  if (!Array.isArray(list) || list.length === 0) {
    throw new Refusal(at + '.' + key + ' must be a non-empty array of strings')
  }
  const out = []
  for (let i = 0; i < list.length; i++) {
    if (typeof list[i] !== 'string' || list[i].trim() === '') {
      throw new Refusal(at + '.' + key + '[' + i + '] must be a non-empty string')
    }
    out.push(list[i].trim())
  }
  if (new Set(out).size !== out.length) {
    throw new Refusal(at + '.' + key + ' contains a duplicate entry')
  }
  return out
}

function normalizeKey(value) {
  return String(value).trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function slugify(value) {
  const slug = String(value)
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return Array.from(slug).slice(0, 64).join('').replace(/-+$/g, '')
}

function parseQuantities(raw) {
  const list = raw.quantities
  if (!Array.isArray(list) || list.length === 0) {
    throw new Refusal('description.quantities must be a non-empty array')
  }
  const seen = new Set()
  const out = []
  for (let i = 0; i < list.length; i++) {
    const at = 'description.quantities[' + i + ']'
    const item = list[i]
    if (!isPlainObject(item)) throw new Refusal(at + ' must be an object')
    checkKeys(item, QUANTITY_KEYS, at)
    const name = requireString(item, 'name', at)
    if (/[\r\n]/.test(name)) throw new Refusal(at + '.name must be a single line')
    if (seen.has(name)) throw new Refusal(at + '.name "' + name + '" is registered more than once')
    seen.add(name)
    const measures = requireString(item, 'measures', at)
    const standingRaw = requireString(item, 'standing', at)
    const standing = STANDING.get(normalizeKey(standingRaw))
    if (standing === undefined) {
      throw new Refusal(at + '.standing "' + standingRaw + '" is not recognized; use active, caveat, or deprecated')
    }
    out.push({ name: name, measures: inline(measures), status: standing })
  }
  return out
}

function parseLiveVars(raw) {
  const list = raw.liveVars
  if (!Array.isArray(list) || list.length === 0) {
    throw new Refusal('description.liveVars must be a non-empty array')
  }
  const seen = new Set()
  const out = []
  for (let i = 0; i < list.length; i++) {
    const at = 'description.liveVars[' + i + ']'
    const item = list[i]
    if (!isPlainObject(item)) throw new Refusal(at + ' must be an object')
    checkKeys(item, LIVEVAR_KEYS, at)
    const name = requireString(item, 'name', at)
    if (/[\r\n]/.test(name)) throw new Refusal(at + '.name must be a single line')
    if (seen.has(name)) throw new Refusal(at + '.name "' + name + '" is registered more than once')
    seen.add(name)
    const why = requireString(item, 'why', at)
    const statusRaw = requireString(item, 'status', at)
    const status = LIVE_STATUS.get(normalizeKey(statusRaw))
    if (status === undefined) {
      throw new Refusal(at + '.status "' + statusRaw + '" is not recognized; use LIVE, DEAD, UNKNOWN, or TESTED_WEAK')
    }
    out.push({ name: name, why: inline(why), status: status })
  }
  return out
}

function parseFloor(value) {
  if (!isPlainObject(value)) {
    throw new Refusal('description.evidenceFloor must be an object with minSources and minRuns')
  }
  checkKeys(value, FLOOR_KEYS, 'description.evidenceFloor')
  // No second copy of the threshold rules: the values go into the pack unchanged and
  // validatePack decides whether they are valid. A bad floor is refused there, exit 2.
  return {
    minSources: value.minSources,
    minRuns: value.minRuns,
  }
}

function unknownAtomMessage(bad) {
  return 'check(s) outside the closed vocabulary: '
    + bad.map(function (atom) { return JSON.stringify(atom) }).join(', ')
    + '. The generator does not invent atoms. Legal atoms (' + ATOMS.size + '):\n'
    + [...ATOMS].map(function (atom) { return '  - ' + atom }).join('\n')
}

function parseChecks(value) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0) {
    throw new Refusal('description.checks, when present, must be a non-empty array of atom names')
  }
  const bad = []
  const seen = new Set()
  const out = []
  for (let i = 0; i < value.length; i++) {
    const item = value[i]
    if (typeof item !== 'string' || item.trim() === '') {
      throw new Refusal('description.checks[' + i + '] must be a non-empty atom name')
    }
    const atom = item.trim()
    if (!ATOMS.has(atom)) {
      bad.push(atom)
      continue
    }
    if (seen.has(atom)) throw new Refusal('description.checks lists "' + atom + '" more than once')
    seen.add(atom)
    out.push(atom)
  }
  if (bad.length > 0) throw new Refusal(unknownAtomMessage(bad))
  return out
}

function parseDescription(raw) {
  if (!isPlainObject(raw)) throw new Refusal('the description must be a JSON object')
  for (const key of Object.keys(raw)) {
    if (key.startsWith('_')) continue
    if (!INPUT_KEYS.has(key)) {
      if (key === 'rules' || key === 'warnings') {
        throw new Refusal('field "' + key + '" is not accepted: this generator fills the package default composition; it does not author rules')
      }
      throw new Refusal('unknown field "' + key + '"; allowed fields: ' + [...INPUT_KEYS].join(', '))
    }
  }
  const domain = requireString(raw, 'domain', 'description')
  const title = raw.title === undefined ? domain : requireString(raw, 'title', 'description')
  const description = requireString(raw, 'description', 'description')
  const words = optionalStringArray(raw, 'words', 'description')
  const paths = optionalStringArray(raw, 'paths', 'description')
  const quantities = parseQuantities(raw)
  const liveVars = parseLiveVars(raw)
  const floor = parseFloor(raw.evidenceFloor)
  const checks = parseChecks(raw.checks)
  const slug = slugify(domain)
  if (slug === '') throw new Refusal('domain "' + domain + '" does not yield a file-safe pack name')
  if (RESERVED_NAMES.has(slug.toLowerCase())) {
    throw new Refusal('domain "' + domain + '" yields a Windows-reserved file name; choose another domain name')
  }
  return {
    domain: domain,
    title: inline(title),
    description: inline(description),
    words: words,
    paths: paths,
    quantities: quantities,
    liveVars: liveVars,
    floor: floor,
    checks: checks,
    slug: slug,
  }
}

function assertAtomHelp() {
  const missing = [...ATOMS].filter(function (atom) { return typeof ATOM_HELP[atom] !== 'function' })
  const extra = Object.keys(ATOM_HELP).filter(function (atom) { return !ATOMS.has(atom) })
  if (missing.length > 0 || extra.length > 0) {
    throw new Refusal("the generator's atom descriptions are out of date with src/evaluate.mjs (missing: "
      + (missing.join(', ') || 'none') + '; extra: ' + (extra.join(', ') || 'none') + ')')
  }
}

function composedAtoms(pack) {
  const atoms = new Set()
  const sections = [pack.rules, pack.warnings]
  for (const section of sections) {
    if (section === undefined) continue
    for (const rule of Object.values(section)) {
      for (const check of rule.checks) atoms.add(check.atom)
    }
  }
  return atoms
}

function assertTemplate(pack) {
  const covered = composedAtoms(pack)
  const missing = [...ATOMS].filter(function (atom) { return !covered.has(atom) })
  if (missing.length > 0) {
    throw new Refusal('the package default composition does not use atom(s): ' + missing.join(', ')
      + '. Refusing to invent a rule; update this generator when the composition changes.')
  }
}

function loadTemplate() {
  let loaded
  try {
    loaded = loadPack()
  } catch (error) {
    throw new Refusal('the package default pack is not loadable, so no draft can be composed: ' + message(error))
  }
  assertTemplate(loaded.pack)
  return loaded
}

function whenPhrase(when) {
  if (when === 'negative') return 'on negative claims only'
  if (when === 'non-negative') return 'on non-negative claims only'
  return 'on every claim'
}

function ruleMeaning(rule, thresholds) {
  return rule.checks.map(function (check) {
    return ATOM_HELP[check.atom](thresholds)
  }).join('; ')
}

function composeLines(rules, warnings, thresholds) {
  const lines = []
  for (const id of Object.keys(rules)) {
    lines.push(id + ' ' + whenPhrase(rules[id].when) + ': ' + ruleMeaning(rules[id], thresholds))
  }
  for (const id of Object.keys(warnings)) {
    lines.push(id + ' (warning only) ' + whenPhrase(warnings[id].when) + ': ' + ruleMeaning(warnings[id], thresholds))
  }
  return lines.join('; ')
}

function coverageForAtom(rules, warnings, atom) {
  const hard = []
  const warn = []
  for (const id of Object.keys(rules)) {
    if (rules[id].checks.some(function (check) { return check.atom === atom })) hard.push(id)
  }
  for (const id of Object.keys(warnings)) {
    if (warnings[id].checks.some(function (check) { return check.atom === atom })) warn.push(id)
  }
  return { hard: hard, warn: warn }
}

function buildDescription(desc, thresholds, rules, warnings) {
  const parts = []
  parts.push('DRAFT for human review - ' + inline(desc.title) + '.')
  parts.push(desc.description)
  parts.push('Registered quantities: ' + desc.quantities.map(function (q) {
    return q.name + ' (' + q.measures + '; ' + q.status + ')'
  }).join('; ') + '.')
  parts.push('Live variables: ' + desc.liveVars.map(function (v) {
    return v.name + ' (' + v.why + '; ' + v.status + ')'
  }).join('; ') + '.')
  parts.push('Gates: ' + composeLines(rules, warnings, thresholds) + '.')
  if (desc.checks !== undefined) {
    parts.push('The description asked for these checks: ' + desc.checks.map(function (atom) {
      const coverage = coverageForAtom(rules, warnings, atom)
      const ids = coverage.hard.concat(coverage.warn.map(function (id) { return id + ' warning' }))
      return atom + ' (' + (ids.join('/') || 'not composed') + ')'
    }).join('; ') + '.')
  }
  parts.push('Thresholds: minSources=' + thresholds.minSources + ', minRuns=' + thresholds.minRuns + '.')
  parts.push('Generated by scripts/gen-pack.mjs from a domain description; not adopted until a reviewer accepts the REVIEW.md alongside this pack.')
  return parts.join(' ')
}

function validateSerializedPack(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Refusal('serialized pack is not valid JSON: ' + message(error))
  }
  try {
    validatePack(parsed)
  } catch (error) {
    throw new Refusal('the draft was refused by src/pack.mjs validatePack(): ' + message(error))
  }
  return parsed
}

function sourceList(count, packName) {
  const out = []
  for (let i = 0; i < count; i++) {
    out.push({
      url: 'https://example.invalid/' + packName + '/source-' + (i + 1),
      kind: 'synthetic',
    })
  }
  return out
}

function runIds(count) {
  const out = []
  for (let i = 0; i < count; i++) out.push('run-' + (i + 1))
  return out
}

function syntheticRepro(caseName, quantity) {
  return {
    cmd: 'synthetic: measure ' + quantity + ' for ' + caseName,
    observed: 'synthetic observation for ' + caseName,
  }
}

function uniqueName(base, taken) {
  let candidate = base
  let n = 2
  while (taken.has(candidate)) {
    candidate = base + '-' + n
    n += 1
  }
  return candidate
}

function makeSample(pack, spec) {
  const body = {
    _spdx: 'SPDX-License-Identifier: MIT',
    _what: spec.what,
    _title: spec.title,
    _expect: spec.expect,
    claim: spec.claim,
    polarity: spec.polarity,
    scope: pack.name,
    sources: sourceList(spec.sources, pack.name),
    ...(spec.probe === undefined ? {} : { same_model_positive_search: spec.probe }),
    metrics: spec.metrics,
    ...(spec.contrast === undefined ? {} : { contrast: spec.contrast }),
    repro: spec.repro,
    tested: spec.tested,
  }
  return { file: spec.file, body: body }
}

function buildSamples(desc, pack) {
  const minSources = pack.thresholds.minSources
  const minRuns = pack.thresholds.minRuns
  const first = desc.quantities[0].name
  const active = desc.quantities.find(function (q) { return q.status !== 'deprecated_as_sole_criterion' })
  const deprecated = desc.quantities.find(function (q) { return q.status === 'deprecated_as_sole_criterion' })
  const live = desc.liveVars.filter(function (v) { return v.status === 'LIVE' })
  const nonLive = desc.liveVars.find(function (v) { return v.status !== 'LIVE' })
  const metricNames = new Set(Object.keys(pack.metrics))
  const liveNames = new Set(Object.keys(pack.liveVars))
  const unregisteredMetric = uniqueName(pack.name + '.unregistered_quantity', metricNames)
  const unregisteredVar = uniqueName(pack.name + '.unregistered_variable', liveNames)
  const passMetrics = active === undefined ? [] : [active.name]
  const passContrast = live.length === 0 ? undefined : {
    arms: ['arm-a', 'arm-b'],
    diff_vars: live.map(function (v) { return v.name }),
  }
  const failMetric = deprecated === undefined ? unregisteredMetric : deprecated.name
  const failVar = nonLive === undefined ? unregisteredVar : nonLive.name
  const metricFile = deprecated === undefined ? 'fail_metric_unregistered.json' : 'fail_metric_deprecated.json'
  const contrastFile = nonLive === undefined ? 'fail_contrast_unregistered.json' : 'fail_contrast_not_live.json'
  const shortRuns = Math.max(0, minRuns - 1)
  const passFacts = [
    minSources + ' distinct sources',
    'a recorded same-model search with 0 hits',
  ]
  if (active !== undefined) passFacts.push('a registered non-deprecated quantity')
  if (live.length > 0) passFacts.push('LIVE contrast variables')
  passFacts.push('repro fields', minRuns + ' runs')
  const samples = []

  samples.push(makeSample(pack, {
    file: 'pass_all.json',
    title: 'all gates pass',
    what: 'Synthetic shape fixture, not evidence: every gate can be satisfied at once - '
      + passFacts.join(', ') + '.',
    expect: { pass: true, fails: [], warns: [] },
    claim: 'Surface evidence alone cannot establish ' + first + ' for this domain.',
    polarity: 'negative',
    sources: minSources,
    probe: { done: true, queries: ['same-model positive search for ' + pack.name], hits: 0 },
    metrics: passMetrics,
    contrast: passContrast,
    repro: syntheticRepro('pass_all', first),
    tested: { run_ids: runIds(minRuns), runs: minRuns },
  }))

  samples.push(makeSample(pack, {
    file: 'fail_sources.json',
    title: 'one source short (R1)',
    what: 'Synthetic shape fixture, not evidence: ' + Math.max(0, minSources - 1)
      + ' distinct source(s), one fewer than minSources; every other gate is satisfied, so only R1 should fail.',
    expect: { pass: false, fails: ['R1'], warns: [] },
    claim: 'A measured value of ' + first + ' was recorded.',
    polarity: 'observation',
    sources: Math.max(0, minSources - 1),
    metrics: passMetrics,
    contrast: passContrast,
    repro: syntheticRepro('fail_sources', first),
    tested: { run_ids: runIds(minRuns), runs: minRuns },
  }))

  samples.push(makeSample(pack, {
    file: 'fail_counter_search.json',
    title: 'no same-model search (R2)',
    what: 'Synthetic shape fixture, not evidence: a negative claim with no recorded same-model positive search; '
      + 'every other gate is satisfied, so only R2 should fail.',
    expect: { pass: false, fails: ['R2'], warns: [] },
    claim: 'Surface evidence alone cannot establish ' + first + ' for this domain.',
    polarity: 'negative',
    sources: minSources,
    probe: { done: false, queries: [], hits: 0 },
    metrics: passMetrics,
    contrast: passContrast,
    repro: syntheticRepro('fail_counter_search', first),
    tested: { run_ids: runIds(minRuns), runs: minRuns },
  }))

  samples.push(makeSample(pack, {
    file: metricFile,
    title: deprecated === undefined ? 'unregistered quantity (R3)' : 'deprecated quantity (R3)',
    what: deprecated === undefined
      ? 'Synthetic shape fixture, not evidence: a claim cites a quantity absent from the pack; every other gate is satisfied, so only R3 should fail.'
      : 'Synthetic shape fixture, not evidence: a claim cites a quantity registered as deprecated_as_sole_criterion; every other gate is satisfied, so only R3 should fail.',
    expect: { pass: false, fails: ['R3'], warns: [] },
    claim: 'The photograph suggests a value for ' + failMetric + '.',
    polarity: 'observation',
    sources: minSources,
    metrics: [failMetric],
    contrast: passContrast,
    repro: syntheticRepro('fail_metric', failMetric),
    tested: { run_ids: runIds(minRuns), runs: minRuns },
  }))

  samples.push(makeSample(pack, {
    file: contrastFile,
    title: nonLive === undefined ? 'unregistered contrast variable (R4)' : 'non-LIVE contrast variable (R4)',
    what: nonLive === undefined
      ? 'Synthetic shape fixture, not evidence: a contrast differs on a variable absent from liveVars; every other gate is satisfied, so only R4 should fail.'
      : 'Synthetic shape fixture, not evidence: a contrast differs on a variable whose status is not LIVE; every other gate is satisfied, so only R4 should fail.',
    expect: { pass: false, fails: ['R4'], warns: [] },
    claim: 'The two arms differ in ' + failVar + '.',
    polarity: 'observation',
    sources: minSources,
    metrics: passMetrics,
    contrast: { arms: ['arm-a', 'arm-b'], diff_vars: [failVar] },
    repro: syntheticRepro('fail_contrast', first),
    tested: { run_ids: runIds(minRuns), runs: minRuns },
  }))

  samples.push(makeSample(pack, {
    file: 'warn_runs.json',
    title: 'one run short (W1 warning)',
    what: 'Synthetic shape fixture, not evidence: ' + shortRuns + ' run(s), one fewer than minRuns; '
      + 'every hard rule passes, W1 warns, and the verdict still passes.',
    expect: { pass: true, fails: [], warns: ['W1'] },
    claim: 'A value of ' + first + ' was recorded.',
    polarity: 'observation',
    sources: minSources,
    metrics: passMetrics,
    contrast: passContrast,
    repro: syntheticRepro('warn_runs', first),
    tested: { run_ids: runIds(shortRuns), runs: shortRuns },
  }))

  return samples
}

function ruleIds(messages) {
  const ids = new Set()
  for (const text of messages) {
    const match = /^\[([A-Za-z0-9]+)-/.exec(text)
    ids.add(match === null ? 'UNKNOWN' : match[1])
  }
  return [...ids].sort()
}

function sameList(left, right) {
  const a = left.slice().sort()
  const b = right.slice().sort()
  return a.length === b.length && a.every(function (value, i) { return value === b[i] })
}

function outcomeLabel(pass, fails, warns) {
  const parts = [pass ? 'PASS' : 'FAIL']
  if (fails.length > 0) parts.push('fails ' + fails.join(', '))
  if (warns.length > 0) parts.push('warns ' + warns.join(', '))
  return parts.join('; ')
}

function verifySamples(pack, samples) {
  const results = []
  for (const sample of samples) {
    let result
    try {
      result = evaluate(pack, sample.body)
    } catch (error) {
      throw new Refusal('fixture ' + sample.file + ' could not be evaluated: ' + message(error))
    }
    const expected = sample.body._expect
    const fails = ruleIds(result.fails)
    const warns = ruleIds(result.warns)
    const ok = result.pass === expected.pass && sameList(fails, expected.fails) && sameList(warns, expected.warns)
    if (!ok) {
      throw new Refusal('fixture ' + sample.file + ' does not match its declared outcome: expected '
        + outcomeLabel(expected.pass, expected.fails, expected.warns) + '; evaluate() returned '
        + outcomeLabel(result.pass, fails, warns) + '. The draft was not written.')
    }
    results.push({ file: sample.file, expect: expected, result: result })
  }
  return results
}

function appendRuleRows(lines, section, warning, thresholds) {
  for (const id of Object.keys(section)) {
    const rule = section[id]
    const atoms = rule.checks.map(function (check) {
      return mdCell(check.atom + (check.over === undefined ? '' : ' over ' + check.over))
    }).join('<br>')
    const reads = Array.from(new Set(rule.checks.map(function (check) {
      return check.over === undefined ? 'verdict' : 'verdict.' + check.over
    }))).join('<br>')
    const meaning = mdCell(ruleMeaning(rule, thresholds)) + (warning ? ' (warning only; does not fail)' : '')
    lines.push('| ' + mdCell(id + (warning ? ' (warning)' : '')) + ' | ' + mdCell(whenPhrase(rule.when))
      + ' | ' + atoms + ' | ' + reads + ' | ' + meaning + ' |')
  }
}

function buildReview(desc, pack, sourceLabel, generatedAt, packHash, templateHash, samples, results) {
  const lines = []
  lines.push('<!-- SPDX-License-Identifier: MIT -->')
  lines.push('# Draft review: ' + inline(desc.title))
  lines.push('')
  lines.push('Generated ' + generatedAt + ' from ' + mdCell(sourceLabel) + ' by scripts/gen-pack.mjs.')
  lines.push('')
  lines.push('Pack: packs/' + pack.name + '.json - sha256 ' + packHash + '.')
  lines.push('Composition copied from packs/generic.json - sha256 ' + templateHash + '.')
  lines.push('Trigger words: ' + mdCell(pack.words.join('; ')) + '.')
  lines.push('Watched paths: ' + mdCell(pack.paths.join('; ')) + '.')
  lines.push('')
  lines.push('This is a draft. No profile points at it until a human accepts it; the pack description says so too.')
  lines.push('')
  lines.push('## Accept or reject - check these')
  lines.push('')
  lines.push('- [ ] **Quantities.** Each name is a quantity this domain actually claims about, and each "measures" sentence says what it measures without borrowing a neighbouring definition.')
  lines.push('- [ ] **Standings.** Each deprecated_as_sole_criterion quantity is unfit to stand alone for these claims, not merely old; each active or caveat quantity is fit for the role it is cited in. R3 checks the label, not this judgement.')
  lines.push('- [ ] **Live variables.** Each LIVE variable really makes a comparison fair; each DEAD, UNKNOWN, or TESTED_WEAK variable really does not. R4 trusts these labels.')
  lines.push('- [ ] **Evidence floor.** minSources=' + pack.thresholds.minSources + ' and minRuns=' + pack.thresholds.minRuns + ' are numbers this domain would defend. R1 fails below the source floor; W1 only warns below the run floor.')
  lines.push('- [ ] **Trigger words.** The ' + pack.words.length + ' phrases catch the claims this domain cares about and do not catch ordinary description. The plugin reads these words, not the claim grammar.')
  lines.push('- [ ] **Composition.** The draft composes all eight atoms from the package default. If the domain needs a check outside those eight, stop and change the code; do not add an atom to this file.')
  lines.push('- [ ] **Fixtures.** The ' + samples.length + ' fixtures are synthetic shape tests, not evidence. Confirm the passing one is a claim you would accept on these terms and each failing one fails for the rule printed.')
  lines.push('- [ ] **Adoption.** Only after the boxes above: point packPath at the pack file and remove the DRAFT prefix from its description. Re-run the generator if you edit the input.')
  lines.push('')
  lines.push('## Rule composition (copied from packs/generic.json, not invented)')
  lines.push('')
  lines.push('| rule | applies | atoms | reads | what it enforces |')
  lines.push('|---|---|---|---|---|')
  appendRuleRows(lines, pack.rules, false, pack.thresholds)
  appendRuleRows(lines, pack.warnings, true, pack.thresholds)
  lines.push('')
  lines.push('## Registered quantities and live variables')
  lines.push('')
  lines.push('| quantity | what it measures | status |')
  lines.push('|---|---|---|')
  for (const q of desc.quantities) {
    lines.push('| ' + mdCell(q.name) + ' | ' + mdCell(q.measures) + ' | ' + mdCell(q.status) + ' |')
  }
  lines.push('')
  lines.push('| live variable | why it is required | status |')
  lines.push('|---|---|---|')
  for (const v of desc.liveVars) {
    lines.push('| ' + mdCell(v.name) + ' | ' + mdCell(v.why) + ' | ' + mdCell(v.status) + ' |')
  }
  lines.push('')
  lines.push('## Requested checks')
  lines.push('')
  if (desc.checks === undefined) {
    lines.push('The description did not name a checks list. The draft still composes all eight atoms above; the checks list is a coverage assertion, not a way to add or remove a rule.')
  } else {
    lines.push('| atom | enforced by | hard rule? |')
    lines.push('|---|---|---|')
    for (const atom of desc.checks) {
      const coverage = coverageForAtom(pack.rules, pack.warnings, atom)
      const enforced = coverage.hard.concat(coverage.warn.map(function (id) { return id + ' (warning)' }))
      const hard = coverage.hard.length > 0 ? 'yes' : 'no - warning only'
      lines.push('| ' + mdCell(atom) + ' | ' + mdCell(enforced.join(', ') || 'not composed') + ' | ' + hard + ' |')
    }
  }
  lines.push('')
  lines.push('## Fixtures (evaluated against this pack at generation time)')
  lines.push('')
  lines.push('| file | synthetic claim shape | expected | observed |')
  lines.push('|---|---|---|---|')
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]
    const expected = sample.body._expect
    const actual = results[i].result
    lines.push('| samples/' + sample.file + ' | ' + mdCell(sample.body._title) + ' | '
      + outcomeLabel(expected.pass, expected.fails, expected.warns) + ' | '
      + outcomeLabel(actual.pass, ruleIds(actual.fails), ruleIds(actual.warns)) + ' |')
  }
  lines.push('')
  lines.push('Every fixture was run through evaluate(pack, fixture) before this file was written; a mismatch would have refused the draft. The fixtures test the pack mechanics, not the truth of any domain claim.')
  lines.push('')
  lines.push('## Generator notes')
  lines.push('')
  lines.push('- R1 composes sources>=minSources with no over. validatePack now refuses a pack that states an evidence floor and never applies it, so the source floor is always enforced, even when the checks list does not name it.')
  lines.push('- minRuns is composed in warnings (W1), not rules: it warns and does not fail. A hard run floor is a composition change, not an input change.')
  const active = desc.quantities.filter(function (q) { return q.status !== 'deprecated_as_sole_criterion' })
  if (active.length === 0) {
    lines.push('- No quantity is active or caveat: pass_all cites no quantity, so R3 is vacuous there. Any claim citing a registered deprecated quantity fails R3.')
  }
  const live = desc.liveVars.filter(function (v) { return v.status === 'LIVE' })
  if (live.length === 0) {
    lines.push('- No live variable has status LIVE: pass_all omits contrast, so R4 is vacuous there. A contrast naming a non-LIVE or unregistered variable fails R4.')
  }
  if (pack.thresholds.minSources === 1) {
    lines.push('- minSources=1: a single source satisfies R1. Confirm that is a floor, not a placeholder.')
  }
  if (pack.thresholds.minRuns === 1) {
    lines.push('- minRuns=1: W1 can only warn at 0 runs. Confirm the run floor is meaningful.')
  }
  if (desc.checks !== undefined) {
    const warningOnly = desc.checks.filter(function (atom) {
      const coverage = coverageForAtom(pack.rules, pack.warnings, atom)
      return coverage.hard.length === 0 && coverage.warn.length > 0
    })
    if (warningOnly.length > 0) {
      lines.push('- Requested check(s) enforced only as warnings: ' + warningOnly.join(', ') + '. If the domain needs these to fail, the composition must change.')
    }
  }
  lines.push('')
  lines.push('## Reproduce')
  lines.push('')
  lines.push('From the repository root:')
  lines.push('')
  lines.push('    node scripts/gen-pack.mjs --selftest')
  lines.push('    node --input-type=module -e "import { loadPack } from \'./src/pack.mjs\'; const { pack } = loadPack(process.argv[1]); console.log(pack.name + \' valid\')" <out>/packs/' + pack.name + '.json')
  lines.push('')
  lines.push('The generator read this input, copied the default composition, validated the serialized bytes with validatePack, and evaluated every fixture before writing. Re-running the same input into an empty directory reproduces the pack bytes and the pack hash above.')
  lines.push('')
  lines.push('## What the generator decided, and what it did not')
  lines.push('')
  lines.push('Decided: schemaVersion, pack and file names, the rule composition (a copy of packs/generic.json; no atom added or removed), the status spellings, the thresholds exactly as written in evidenceFloor, the fixtures and their expected outcomes, and the hashes above.')
  lines.push('')
  lines.push('Not decided: whether the description is true, whether these are the right quantities and liveness labels, whether the floor is adequate, whether the trigger words are the right ones, whether the composition is sufficient for the domain, and whether to adopt the pack. Those are the checkboxes above.')
  return lines.join('\n') + '\n'
}

function buildDraft(desc, templateInfo, sourceLabel, generatedAt) {
  assertAtomHelp()
  const template = templateInfo.pack
  const thresholds = { minSources: desc.floor.minSources, minRuns: desc.floor.minRuns }
  const rules = structuredClone(template.rules)
  const warnings = structuredClone(template.warnings)
  const metrics = Object.fromEntries(desc.quantities.map(function (q) {
    return [q.name, { status: q.status }]
  }))
  const liveVars = Object.fromEntries(desc.liveVars.map(function (v) {
    return [v.name, { status: v.status }]
  }))
  const pack = {
    schemaVersion: template.schemaVersion,
    name: desc.slug,
    description: buildDescription(desc, thresholds, rules, warnings),
    paths: desc.paths === undefined ? template.paths.slice() : desc.paths.slice(),
    words: desc.words === undefined ? template.words.slice() : desc.words.slice(),
    thresholds: thresholds,
    rules: rules,
    warnings: warnings,
    metrics: metrics,
    liveVars: liveVars,
  }
  const packText = JSON.stringify(pack, null, 2) + '\n'
  validateSerializedPack(packText)
  const samples = buildSamples(desc, pack)
  const results = verifySamples(pack, samples)
  const templateText = readFileSync(templateInfo.path)
  const packHash = sha256(packText)
  const templateHash = sha256(templateText)
  const review = buildReview(desc, pack, sourceLabel, generatedAt, packHash, templateHash, samples, results)
  return {
    pack: pack,
    packText: packText,
    packHash: packHash,
    templateHash: templateHash,
    samples: samples,
    results: results,
    review: review,
  }
}

function outputFiles(draft) {
  const files = [{ path: join('packs', draft.pack.name + '.json'), text: draft.packText }]
  for (const sample of draft.samples) {
    files.push({ path: join('samples', sample.file), text: JSON.stringify(sample.body, null, 2) + '\n' })
  }
  files.push({ path: 'REVIEW.md', text: draft.review })
  return files
}

function writeDraft(outDir, draft, force) {
  const files = outputFiles(draft)
  const targets = files.map(function (file) { return join(outDir, file.path) })
  if (!force) {
    const existing = targets.filter(function (target) { return existsSync(target) })
    if (existing.length > 0) {
      throw new UsageError('output already exists (use --force to overwrite): ' + existing.map(function (target) {
        return relative(outDir, target)
      }).join(', '))
    }
  }
  if (existsSync(outDir) && !statSync(outDir).isDirectory()) {
    throw new UsageError('--out is not a directory: ' + outDir)
  }
  for (let i = 0; i < files.length; i++) {
    try {
      mkdirSync(dirname(targets[i]), { recursive: true })
      writeFileSync(targets[i], files[i].text, 'utf8')
    } catch (error) {
      throw new UsageError('cannot write ' + targets[i] + ': ' + message(error))
    }
  }
  return targets
}

function readDescriptionFile(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new UsageError('cannot read --from file "' + path + '": ' + message(error))
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch (error) {
    throw new UsageError('--from file is not valid JSON: ' + message(error))
  }
}

function parseArgs(argv) {
  const args = { from: undefined, out: undefined, force: false, selftest: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      args.help = true
      continue
    }
    if (arg === '--selftest') {
      args.selftest = true
      continue
    }
    if (arg === '--force') {
      args.force = true
      continue
    }
    if (arg === '--from' || arg === '--out') {
      const value = argv[i + 1]
      if (value === undefined || value === '' || value.indexOf('--') === 0) {
        throw new UsageError(arg + ' needs a path')
      }
      if (arg === '--from') args.from = resolve(value)
      else args.out = resolve(value)
      i += 1
      continue
    }
    const equals = /^--(from|out)=(.+)$/.exec(arg)
    if (equals !== null) {
      args[equals[1]] = resolve(equals[2])
      continue
    }
    if (arg.indexOf('-') === 0) throw new UsageError('unknown option: ' + arg)
    throw new UsageError('unexpected argument: ' + arg)
  }
  if (args.help) {
    if (args.selftest || args.from !== undefined || args.out !== undefined || args.force) {
      throw new UsageError('--help cannot be combined with other options')
    }
    return args
  }
  if (args.selftest) {
    if (args.from !== undefined || args.out !== undefined || args.force) {
      throw new UsageError('--selftest does not take --from, --out, or --force')
    }
    return args
  }
  if (args.from === undefined || args.out === undefined) {
    throw new UsageError('both --from and --out are required')
  }
  return args
}

const SELFTEST_DESCRIPTION = {
  _spdx: 'SPDX-License-Identifier: MIT',
  _what: 'In-memory fixture for --selftest; not written to disk.',
  domain: 'sourdough-crumb',
  title: 'Sourdough crumb study',
  description: 'Claims about whether an open crumb can be established from a single crumb photograph.',
  words: ['cannot be established', 'impossible', 'no way to tell'],
  paths: ['notes/'],
  quantities: [
    { name: 'crumb.open_area_frac', measures: 'fraction of the slice that is open crumb', standing: 'active' },
    { name: 'crumb.visual_score', measures: "baker's 1-5 visual score", standing: 'deprecated' },
  ],
  liveVars: [
    { name: 'hydration_pct', why: 'both loaves must be mixed at the same hydration', status: 'LIVE' },
    { name: 'oven_steam', why: 'steam was not held constant across the bake', status: 'UNKNOWN' },
  ],
  evidenceFloor: { minSources: 2, minRuns: 3 },
  checks: [
    'sources>=minSources',
    'counter_search_done',
    'counter_search_clear',
    'metric_registered',
    'metric_not_deprecated',
    'var_live',
    'repro_present',
    'runs>=minRuns',
  ],
}

function check(condition, label) {
  if (!condition) throw new SelftestFailure(label)
}

function firstLine(value) {
  const text = String(value)
  const at = text.indexOf('\n')
  return at === -1 ? text : text.slice(0, at)
}

function expectRefusal(fn, label, assertMessage) {
  let error = null
  try {
    fn()
  } catch (caught) {
    error = caught
  }
  if (error === null) throw new SelftestFailure('expected a refusal for ' + label + ', got none')
  if (!(error instanceof Refusal)) {
    throw new SelftestFailure('expected Refusal for ' + label + ', got ' + error.name + ': ' + message(error))
  }
  if (assertMessage !== undefined) assertMessage(error.message)
  console.log('  [OK] refusal: ' + label + ' - ' + firstLine(error.message))
}

function runSelftest() {
  console.log('selftest: in-memory fixture (no output files)')
  const templateInfo = loadTemplate()
  const desc = parseDescription(structuredClone(SELFTEST_DESCRIPTION))
  const draft = buildDraft(desc, templateInfo, 'selftest-fixture', new Date().toISOString())
  check(draft.pack.name === 'sourdough-crumb', 'pack name should be sourdough-crumb')
  check(draft.samples.length === 6, 'expected 6 fixtures, got ' + draft.samples.length)
  check(draft.results.length === 6, 'expected 6 fixture results, got ' + draft.results.length)
  const revalidated = validateSerializedPack(draft.packText)
  check(revalidated.name === draft.pack.name, 'serialized pack should round-trip through validatePack')
  const floorRules = Object.keys(draft.pack.rules).filter(function (id) {
    return draft.pack.rules[id].checks.some(function (entry) {
      return entry.atom === 'sources>=minSources' && entry.over === undefined
    })
  })
  check(floorRules.length > 0, 'emitted pack must compose sources>=minSources without over')
  console.log('  [OK] validatePack accepts the draft (' + draft.samples.length + ' fixtures)')
  console.log('  [OK] every fixture matched evaluate()')
  console.log('  [OK] source floor is composed by ' + floorRules.join(', '))

  const broken = structuredClone(draft.pack)
  delete broken.rules[floorRules[0]]
  let refusedWithoutFloor = false
  try {
    validatePack(broken)
  } catch (error) {
    refusedWithoutFloor = /sources>=minSources/.test(message(error))
  }
  check(refusedWithoutFloor, 'validatePack should refuse a pack without the source floor')
  console.log('  [OK] validatePack refuses a pack that drops the source floor')

  expectRefusal(function () {
    validateSerializedPack(JSON.stringify({
      schemaVersion: 99,
      name: 'x',
      paths: [],
      words: ['a'],
      thresholds: { minSources: 1, minRuns: 1 },
      rules: { R1: { checks: [{ atom: 'sources>=minSources' }] } },
      metrics: {},
      liveVars: {},
    }))
  }, 'serialized-bytes guard', function (text) {
    check(text.indexOf('schemaVersion') !== -1, 'guard message should name schemaVersion')
  })

  const unknown = structuredClone(SELFTEST_DESCRIPTION)
  unknown.checks = ['statistical_significance']
  expectRefusal(function () { parseDescription(unknown) }, 'unknown atom', function (text) {
    check(text.indexOf('statistical_significance') !== -1, 'message should name the unknown atom')
    for (const atom of ATOMS) check(text.indexOf(atom) !== -1, 'message should list legal atom ' + atom)
  })

  const badStanding = structuredClone(SELFTEST_DESCRIPTION)
  badStanding.quantities[0].standing = 'probably'
  expectRefusal(function () { parseDescription(badStanding) }, 'unknown quantity standing', function (text) {
    check(text.indexOf('probably') !== -1, 'message should name the bad standing')
  })

  const noFloor = structuredClone(SELFTEST_DESCRIPTION)
  delete noFloor.evidenceFloor
  expectRefusal(function () { parseDescription(noFloor) }, 'missing evidence floor', function (text) {
    check(text.indexOf('evidenceFloor') !== -1, 'message should name evidenceFloor')
  })

  const zeroFloor = structuredClone(SELFTEST_DESCRIPTION)
  zeroFloor.evidenceFloor.minSources = 0
  const zeroDesc = parseDescription(zeroFloor)
  expectRefusal(function () { buildDraft(zeroDesc, templateInfo, 'selftest-fixture', new Date().toISOString()) }, 'zero source floor', function (text) {
    check(text.indexOf('thresholds.minSources') !== -1 && text.indexOf('positive integer') !== -1, 'validatePack should explain the positive integer requirement')
  })

  const rulesField = structuredClone(SELFTEST_DESCRIPTION)
  rulesField.rules = { R1: { checks: [] } }
  expectRefusal(function () { parseDescription(rulesField) }, 'rules field', function (text) {
    check(text.indexOf('rules') !== -1, 'message should name rules')
  })

  const emptyChecks = structuredClone(SELFTEST_DESCRIPTION)
  emptyChecks.checks = []
  expectRefusal(function () { parseDescription(emptyChecks) }, 'empty checks list', function (text) {
    check(text.indexOf('checks') !== -1, 'message should name checks')
  })

  console.log('selftest: PASS (' + draft.samples.length + ' fixtures, ' + ATOMS.size + ' atoms, 7 refusal paths)')
}

function main(argv) {
  const args = parseArgs(argv)
  if (args.help) {
    console.log(USAGE)
    return 0
  }
  if (args.selftest) {
    try {
      runSelftest()
      return 0
    } catch (error) {
      if (error instanceof SelftestFailure) {
        console.error('selftest: FAIL - ' + message(error))
        return 2
      }
      console.error('selftest: FAIL - unexpected ' + message(error))
      return 2
    }
  }
  if (existsSync(args.out) && !statSync(args.out).isDirectory()) {
    throw new UsageError('--out is not a directory: ' + args.out)
  }
  const generatedAt = new Date().toISOString()
  const raw = readDescriptionFile(args.from)
  const desc = parseDescription(raw)
  const templateInfo = loadTemplate()
  const sourceLabel = basename(args.from)
  const draft = buildDraft(desc, templateInfo, sourceLabel, generatedAt)
  const targets = writeDraft(args.out, draft, args.force)
  const packTarget = join(args.out, 'packs', draft.pack.name + '.json')
  let loaded
  try {
    loaded = loadPack(packTarget).pack
  } catch (error) {
    throw new Refusal('the written pack failed the package loader: ' + message(error), { wroteOutput: true })
  }
  if (loaded.name !== draft.pack.name) {
    throw new Refusal('the written pack loaded as "' + loaded.name + '" rather than "' + draft.pack.name + '"', { wroteOutput: true })
  }
  console.log('emitted ' + targets.length + ' file(s) under ' + args.out)
  for (const target of targets) {
    console.log('  ' + relative(args.out, target).split('\\').join('/'))
  }
  console.log('')
  console.log('pack: ' + draft.pack.name + ' (schemaVersion ' + draft.pack.schemaVersion + ') - validatePack() passed before writing and loadPack() read it back')
  console.log('fixtures: ' + draft.samples.length + '/' + draft.samples.length + ' matched evaluate()')
  console.log('review: ' + join(args.out, 'REVIEW.md'))
  return 0
}

let exitCode = 0
try {
  exitCode = main(process.argv.slice(2))
} catch (error) {
  if (error instanceof UsageError) {
    console.error('usage error: ' + message(error))
    console.error('')
    console.error(USAGE)
    exitCode = 1
  } else if (error instanceof Refusal) {
    console.error('refused: ' + message(error))
    console.error(error.wroteOutput ? 'some output was written; inspect it before deleting.' : 'no output was written.')
    exitCode = 2
  } else {
    console.error('unexpected error: ' + message(error))
    if (error !== null && error !== undefined && typeof error.stack === 'string') console.error(error.stack)
    exitCode = 1
  }
}
process.exit(exitCode)
