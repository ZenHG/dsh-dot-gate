// SPDX-License-Identifier: MIT
/**
 * test-survivors.mjs - one test per survived mutant.
 *
 * Each case pins the behaviour the mutant changes, not the implementation: the
 * fixture is the smallest verdict/pack/config that the mutant turns from legal to
 * illegal (or the other way round). Ten mutants, ten tests, no overlap on the
 * atom each one flips.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { apply } from './index.js'
import { evaluate } from './src/evaluate.mjs'
import { loadPack, validatePack } from './src/pack.mjs'
import { checkVerdict } from './src/verdict.mjs'

const H3_PATH = fileURLToPath(new URL('./packs/examples/h3-camera-study.json', import.meta.url))
const H3 = loadPack(H3_PATH).pack
const check = (v) => checkVerdict(v, { pack: H3 })

// The well-formed observation: every rule passes, tested.runs is the pack threshold.
const base = (over) => ({
  claim: 'x',
  polarity: 'observation',
  sources: [{ url: 'a' }, { url: 'b' }, { url: 'c' }],
  metrics: ['farband.far_scale_est'],
  repro: { cmd: 'run it', observed: '0.79' },
  tested: { runs: H3.thresholds.minRuns },
  ...over,
})

// A pack that validates as shipped; cases override exactly one field.
const minimalPack = (over) => ({
  schemaVersion: 2,
  name: 'survivor-fixture',
  paths: ['Wiki/'],
  words: ['做不到'],
  thresholds: { minSources: 2, minRuns: 2 },
  rules: { R1: { checks: [{ atom: 'sources>=minSources' }] } },
  metrics: {},
  liveVars: {},
  ...over,
})

// index.js validates config inside apply(), which is the only exported entry that reaches
// it; the harness is the one test.mjs uses, minus the parts these two cases do not touch.
function harness(config) {
  const handlers = new Map()
  const ctx = {
    on: (ev, fn) => { handlers.set(ev, fn) },
    skills: { registerProvider: () => () => {} },
  }
  apply(ctx, config)
  return {
    emit: (session, event) => handlers.get('session/event')(session, event),
    step: (session) => handlers.get('agent/pre-step')({ agent: { session } }, async () => ({ kind: 'enter', messages: [] })),
  }
}

const wikiWrite = (body) => ({ type: 'tool/call', data: { name: 'write', arguments: { file_path: 'Wiki/Judge.md', content: body } } })
const turnStart = { type: 'turn/start' }

test('M1 evaluate.mjs:68 - exactly minRuns satisfies runs>=minRuns, with no W1 warning', () => {
  const r = check(base())
  assert.equal(r.pass, true)
  assert.deepEqual(r.warns, [], 'a verdict at exactly minRuns must not gain a runs warning')
})

test('M2 evaluate.mjs:50 - a recorded counter-search satisfies counter_search_done', () => {
  const r = check(base({ polarity: 'negative', same_model_positive_search: { done: true, hits: 0 } }))
  assert.ok(
    !r.fails.some((m) => m.includes('must record same_model_positive_search.done=true')),
    'done:true was read as not done',
  )
  assert.equal(r.pass, true)
})

test('M3 pack.mjs:76 - minSources: 1 is a legal threshold', () => {
  const pack = validatePack(minimalPack({ thresholds: { minSources: 1, minRuns: 2 } }))
  assert.equal(pack.thresholds.minSources, 1)
})

test('M4 pack.mjs:77 - minRuns: 1 is a legal threshold', () => {
  const pack = validatePack(minimalPack({ thresholds: { minSources: 2, minRuns: 1 } }))
  assert.equal(pack.thresholds.minRuns, 1)
})

test('M5 pack.mjs:58 - a rule with an empty checks array is refused', () => {
  // R1 keeps the evidence floor (master refuses a pack without it); R2 is the rule that
  // checks nothing, so under the mutant this pack would otherwise validate.
  const rules = { R1: { checks: [{ atom: 'sources>=minSources' }] }, R2: { checks: [] } }
  assert.throws(() => validatePack(minimalPack({ rules })), /rules\.R2\.checks/)
})

test('M6 pack.mjs:80 - a pack with no rules key is refused with the rules diagnostic', () => {
  // The guard comes before the evidence-floor check, so removing it no longer reaches
  // "the pack validates": it calls Object.values(undefined) and dies inside the floor
  // check instead. The guard exists so this fails with the offending key - pack.mjs
  // throws with the key "rather than failing somewhere deep in a rule".
  assert.throws(
    () => validatePack(minimalPack({ rules: undefined })),
    (err) => err instanceof TypeError && err.message.startsWith('dot-gate pack: rules must be an object of rules'),
  )
})

test('M7 evaluate.mjs:54 - hits: 0 means no counter-example was found', () => {
  // done:false isolates the clear atom: the one legal failure is the missing done flag.
  const r = check(base({ polarity: 'negative', same_model_positive_search: { done: false, hits: 0 } }))
  assert.equal(r.fails.length, 1, 'hits:0 must not add a second POSITIVE failure')
  assert.ok(!r.fails[0].includes('found 0 counter-example'))
})

test('M8 index.js:132 - maxPerTurn: 0 is legal and allows no reminder', async () => {
  const h = harness({ maxPerTurn: 0 })
  const s = { id: 'm8' }
  h.emit(s, turnStart)
  h.emit(s, wikiWrite('做不到。'))
  assert.equal((await h.step(s)).messages.length, 0)
})

test('M9 index.js:129 - a words list holding one non-string is refused', () => {
  assert.throws(
    () => harness({ words: ['做不到', 42] }),
    /config\.words must be an array of non-empty strings/,
  )
})

test('M10 evaluate.mjs:71 - the default branch never answers an unknown atom true', () => {
  // validatePack owns the normal path, but evaluate() is exported, so the fallback is
  // reachable directly. It must never turn an unknown atom into a satisfied check.
  const pack = minimalPack({ rules: { RX: { checks: [{ atom: 'looks_fine_to_me' }] } } })
  let pass
  try {
    pass = evaluate(pack, base()).pass
  } catch (error) {
    assert.ok(error instanceof TypeError)
    return
  }
  assert.equal(pass, false, 'an unknown atom was answered true and the verdict passed')
})
