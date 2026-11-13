#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * cross-check.mjs - run the Python gate and the JS gate on the same samples and
 * compare their verdicts.
 *
 * Two implementations of one rule set drift. The drift is silent: both keep
 * answering, they just stop agreeing. This script turns that into a red test.
 *
 * The Python gate is machine-local and must not be referenced from the package,
 * so its path comes from the environment:
 *
 *   VERDICT_GATE_PY=<path to verdict_gate.py> node scripts/cross-check.mjs
 *
 * Exit codes: 0 agree, 1 disagree, 2 not run (no python gate configured).
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkVerdict } from '../src/verdict.mjs'
import { loadPack } from '../src/pack.mjs'
import { createHash } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const GATE = process.env.VERDICT_GATE_PY || ''
const SAMPLES = join(HERE, '..', 'samples')

if (GATE === '' || !existsSync(GATE)) {
  console.log('[--] VERDICT_GATE_PY is not set or does not exist: cross-check skipped (not passed)')
  process.exit(2)
}
if (!existsSync(SAMPLES)) {
  console.log('[--] samples/ is absent: cross-check skipped (not passed)')
  process.exit(2)
}

const files = readdirSync(SAMPLES).filter((n) => n.endsWith('.json'))

// Both implementations must read the same pack, or "they agree" means nothing.
// The packaged default is domain-free; the samples are H3 verdicts, so the comparison runs
// against the example domain pack. That is also the intended usage: a project picks a pack.
const examplePack = process.env.DOT_PACK || join(HERE, '..', 'packs', 'examples', 'h3-camera-study.json')
const { pack, path: packPath } = loadPack(examplePack)
const packHash = createHash('sha256').update(readFileSync(packPath)).digest('hex').slice(0, 12)
console.log('pack=' + pack.name + ' hash=' + packHash)
let disagree = 0
for (const name of files) {
  const path = join(SAMPLES, name)
  const sample = JSON.parse(readFileSync(path, 'utf8'))
  const js = checkVerdict(sample, { pack })
  const py = spawnSync(process.env.PYTHON || 'python', [GATE, '--pack', packPath, path], { encoding: 'utf8' })
  const pyPass = py.status === 0
  const same = js.pass === pyPass
  if (!same) disagree += 1
  console.log((same ? '  [OK]   ' : '  [DIFF] ') + name + '  js=' + (js.pass ? 'PASS' : 'FAIL') + ' py=' + (pyPass ? 'PASS' : 'FAIL'))
}
if (disagree > 0) {
  console.log('')
  console.log('cross-check: ' + disagree + ' sample(s) disagree')
  process.exit(1)
}
console.log('')
console.log('cross-check: ' + files.length + ' sample(s) agree')
process.exit(0)
