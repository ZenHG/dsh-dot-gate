// SPDX-License-Identifier: MIT
/**
 * verdict.mjs - the entry point both callers use.
 *
 * All judgement lives in the pack's expressions, evaluated by evaluate.mjs. This module is a
 * thin delegator on purpose: if a rule ever needs to be expressed here rather than in the
 * pack, that is the signal that the pack's vocabulary is missing an atom - a code change
 * that goes through the four bars in SCOPE.md, not a quiet special case.
 */
import { evaluate } from './evaluate.mjs'
import { loadPack } from './pack.mjs'

/**
 * @param v verdict object
 * @param options { pack?: pack, metrics?: object, live?: object } - metrics/live let a caller
 *   substitute registries without writing a pack (tests and fixtures).
 */
export function checkVerdict(v, options) {
  const opts = options === undefined || options === null ? {} : options
  const base = opts.pack === undefined || opts.pack === null ? loadPack().pack : opts.pack
  const pack = {
    ...base,
    metrics: opts.metrics === undefined ? base.metrics : opts.metrics,
    liveVars: opts.live === undefined ? base.liveVars : opts.live,
  }
  return evaluate(pack, v)
}
