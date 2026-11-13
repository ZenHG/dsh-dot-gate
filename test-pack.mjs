// SPDX-License-Identifier: MIT
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPack, validatePack, PACK_SCHEMA_VERSION } from './src/pack.mjs'
import { checkVerdict } from './src/verdict.mjs'

const H3_PATH = join(process.cwd(), 'packs', 'examples', 'h3-camera-study.json')
const loadH3 = () => loadPack(H3_PATH)

const baseVerdict = (over) => ({
  claim: 'x', polarity: 'observation',
  sources: [{ url: 'a' }, { url: 'b' }, { url: 'c' }],
  metrics: ['farband.far_scale_est'],
  repro: { cmd: 'run', observed: '0.79' },
  tested: { runs: 3 },
  ...over,
})

test('the example domain pack loads and validates', () => {
  const { pack } = loadH3()
  assert.equal(pack.schemaVersion, PACK_SCHEMA_VERSION)
  assert.equal(pack.name, 'h3-camera-study')
  assert.ok(Object.keys(pack.metrics).length > 0)
})

test('the packaged default is domain-free', () => {
  const { pack } = loadPack()
  assert.equal(pack.name, 'generic')
  assert.deepEqual(Object.keys(pack.metrics), [])
  assert.deepEqual(Object.keys(pack.liveVars), [])
  // Same mechanisms, no borrowed quantities: a project registers its own before it can cite one.
  assert.ok(Object.keys(pack.rules).length >= 5)
})

test('a newer schemaVersion is refused', () => {
  assert.throws(() => validatePack({ schemaVersion: 99, name: 'x', paths: [], words: ['a'], thresholds: { minSources: 1, minRuns: 1 }, rules: [], metrics: {}, liveVars: {} }), /schemaVersion/)
})

test('an unknown status is refused with its key', () => {
  const { pack } = loadH3()
  const broken = structuredClone(pack)
  broken.metrics['farband.far_scale_est'].status = 'fine-probably'
  assert.throws(() => validatePack(broken), /metrics\.farband\.far_scale_est\.status/)
})

test('pack thresholds reach the rule', () => {
  const { pack } = loadH3()
  const strict = structuredClone(pack)
  strict.thresholds.minSources = 5
  const r = checkVerdict(baseVerdict(), { pack: strict })
  assert.equal(r.pass, false)
  assert.match(r.fails.join(' '), /requires at least 5/)
})

test('a pack can switch a rule off', () => {
  const { pack } = loadH3()
  const onlySources = structuredClone(pack)
  onlySources.rules = { R1: pack.rules.R1 }
  const r = checkVerdict(baseVerdict({ polarity: 'negative' }), { pack: onlySources })
  // Only R1 is composed, and this verdict satisfies it, so the negative claim is not
  // challenged at all - which is exactly what "the pack composes, it does not invent" means.
  assert.equal(r.fails.length, 0)
  assert.equal(r.pass, true)
})

test('without a pack, the default refuses quantities it does not know', () => {
  // This is the general-tool behaviour: the mechanism ships, the quantities do not.
  const r = checkVerdict(baseVerdict())
  assert.equal(r.pass, false)
  assert.match(r.fails.join(' '), /R3-METRIC/)
})

test('an unknown atom is refused at load, naming the key', () => {
  const { pack } = loadH3()
  const broken = structuredClone(pack)
  broken.rules.R1.checks = [{ atom: 'looks-fine-to-me' }]
  assert.throws(() => validatePack(broken), /rules\.R1\.checks\.0\.atom/)
})

test('an unknown "over" path is refused', () => {
  const { pack } = loadH3()
  const broken = structuredClone(pack)
  broken.rules.R3.checks[0].over = 'anything.at.all'
  assert.throws(() => validatePack(broken), /over/)
})

test('editing an expression changes behaviour without touching code', () => {
  const { pack } = loadH3()
  // Background: this verdict cites a metric that is registered but unfit to stand alone.
  const cites = baseVerdict({ metrics: ['bgscale.div_periph'] })
  assert.equal(checkVerdict(cites, { pack }).pass, false)

  // Remove one atom from one expression. No code changes, no new function.
  const loosened = structuredClone(pack)
  loosened.rules.R3.checks = [{ atom: 'metric_registered', over: 'metrics' }]
  assert.equal(checkVerdict(cites, { pack: loosened }).pass, true)
})

test('a rule cannot read another rule\'s outcome', () => {
  const { pack } = loadH3()
  const broken = structuredClone(pack)
  broken.rules.R2.checks = [{ atom: 'metric_registered', over: 'metrics' }, { atom: 'R1-result' }]
  assert.throws(() => validatePack(broken), /atom/)
})
