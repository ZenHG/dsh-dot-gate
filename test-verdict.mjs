// SPDX-License-Identifier: MIT
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkVerdict, DEFAULT_METRICS, DEFAULT_LIVE_VARS } from './src/verdict.mjs'

const base = (over) => ({
  claim: 'x',
  polarity: 'observation',
  sources: [{ url: 'a' }, { url: 'b' }, { url: 'c' }],
  metrics: ['farband.far_scale_est'],
  repro: { cmd: 'run it', observed: '0.79' },
  tested: { runs: 3 },
  ...over,
})

test('a well-formed observation passes', () => {
  assert.equal(checkVerdict(base()).pass, true)
})

test('R1: fewer than three distinct sources fails', () => {
  const r = checkVerdict(base({ sources: [{ url: 'a' }, { url: 'a' }, { url: 'b' }] }))
  assert.equal(r.pass, false)
  assert.match(r.fails.join(' '), /R1-SOURCES/)
})

test('R2: a negative claim without a counter-example search fails', () => {
  const r = checkVerdict(base({ polarity: 'negative' }))
  assert.match(r.fails.join(' '), /R2-POSITIVE/)
})

test('R2: a negative claim that survived hits fails', () => {
  const r = checkVerdict(base({ polarity: 'negative', same_model_positive_search: { done: true, hits: 2 } }))
  assert.match(r.fails.join(' '), /found 2/)
})

test('R8: an unregistered metric fails', () => {
  const r = checkVerdict(base({ metrics: ['totally.made.up'] }))
  assert.match(r.fails.join(' '), /R3-METRIC/)
})

test('R3: a metric unfit to stand alone fails', () => {
  const r = checkVerdict(base({ metrics: ['bgscale.div_periph'] }))
  assert.match(r.fails.join(' '), /unfit to stand alone/)
})

test('R4: a contrast on a dead variable fails', () => {
  const r = checkVerdict(base({ contrast: { diff_vars: ['focal_length_number'] } }))
  assert.match(r.fails.join(' '), /R4-LIVEVAR/)
})

test('R4: a contrast on a live variable passes', () => {
  const r = checkVerdict(base({ contrast: { diff_vars: ['camera_direction_phrase'] } }))
  assert.equal(r.pass, true)
})

test('R5: missing repro fields fail', () => {
  const r = checkVerdict(base({ repro: {} }))
  assert.match(r.fails.join(' '), /R5-REPRO.*cmd/)
})

test('R6: two runs only warns', () => {
  const r = checkVerdict(base({ tested: { runs: 2 } }))
  assert.equal(r.pass, true)
  assert.equal(r.warns.length, 1)
})

test('the default registries are non-empty', () => {
  assert.ok(Object.keys(DEFAULT_METRICS).length >= 5)
  assert.ok(Object.keys(DEFAULT_LIVE_VARS).length >= 5)
})
