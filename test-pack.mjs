// SPDX-License-Identifier: MIT
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPack, validatePack, PACK_SCHEMA_VERSION } from './src/pack.mjs'
import { checkVerdict } from './src/verdict.mjs'

const baseVerdict = (over) => ({
  claim: 'x', polarity: 'observation',
  sources: [{ url: 'a' }, { url: 'b' }, { url: 'c' }],
  metrics: ['farband.far_scale_est'],
  repro: { cmd: 'run', observed: '0.79' },
  tested: { runs: 3 },
  ...over,
})

test('the shipped pack loads and validates', () => {
  const { pack } = loadPack()
  assert.equal(pack.schemaVersion, PACK_SCHEMA_VERSION)
  assert.equal(pack.name, 'evidence-for-capability-claims')
  assert.ok(Object.keys(pack.metrics).length > 0)
})

test('a newer schemaVersion is refused', () => {
  assert.throws(() => validatePack({ schemaVersion: 99, name: 'x', paths: [], words: ['a'], thresholds: { minSources: 1, minRuns: 1 }, rules: [], metrics: {}, liveVars: {} }), /schemaVersion/)
})

test('an unknown status is refused with its key', () => {
  const { pack } = loadPack()
  const broken = structuredClone(pack)
  broken.metrics['farband.far_scale_est'].status = 'fine-probably'
  assert.throws(() => validatePack(broken), /metrics\.farband\.far_scale_est\.status/)
})

test('pack thresholds reach the rule', () => {
  const { pack } = loadPack()
  const strict = structuredClone(pack)
  strict.thresholds.minSources = 5
  const r = checkVerdict(baseVerdict(), { pack: strict })
  assert.equal(r.pass, false)
  assert.match(r.fails.join(' '), /requires at least 5/)
})

test('a pack can switch a rule off', () => {
  const { pack } = loadPack()
  const onlySources = structuredClone(pack)
  onlySources.rules = ['R1']
  const r = checkVerdict(baseVerdict({ polarity: 'negative' }), { pack: onlySources })
  // Only R1 is selected, and this verdict satisfies it, so the negative claim is not
  // challenged at all - which is exactly what "rules selects" means.
  assert.equal(r.fails.length, 0)
  assert.equal(r.pass, true)
})

test('without a pack the inline defaults still work', () => {
  assert.equal(checkVerdict(baseVerdict()).pass, true)
})
