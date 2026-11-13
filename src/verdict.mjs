// SPDX-License-Identifier: MIT
/**
 * verdict.mjs - the rules, as code.
 *
 * A rule written in prose has to be re-read and re-interpreted every time it is
 * applied. A rule written as a function returns the same answer twice. This file
 * is the second implementation of the same five gates that the project's Python
 * gate applies; scripts/cross-check.mjs exists to keep the two from drifting.
 *
 * It judges the shape of an argument, not the truth of a claim:
 *
 *   R1  at least three distinct sources
 *   R2  a negative capability claim must record that the same-model counter-
 *       example search was done, and must not survive it finding hits
 *   R3  every cited quantity must be registered, and must not be registered as
 *       unfit to stand alone
 *   R4  a contrast may only differ on a variable known to be live
 *   R5  a conclusion must carry a re-runnable command and an observed value
 *   R6  fewer than three runs is a warning, not a failure
 */

export const DEFAULT_METRICS = {
  'bgscale.div_ratio': { status: 'active' },
  'bgscale.div_periph': { status: 'deprecated_as_sole_criterion' },
  'farband.far_scale_est': { status: 'active' },
  'farband.far_div_px': { status: 'active' },
  'h3_facescale.w_frac': { status: 'active' },
  'qc.ref_scale': { status: 'active_with_caveat' },
  'qc.ref_dx': { status: 'active' },
  'qc.ref_dy': { status: 'active' },
  'qc.ref_rot': { status: 'active' },
}

export const DEFAULT_LIVE_VARS = {
  focal_length_number: { status: 'DEAD' },
  lens_model_name: { status: 'DEAD' },
  camera_direction_phrase: { status: 'LIVE' },
  frames_124: { status: 'LIVE' },
  counter_pair: { status: 'TESTED_WEAK' },
  steps_20: { status: 'UNKNOWN' },
  subject_size_lock_clause: { status: 'TESTED_WEAK' },
}

/**
 * @returns {{ fails: string[], warns: string[], pass: boolean }}
 */
export function checkVerdict(v, options) {
  const opts = options === undefined || options === null ? {} : options
  // A pack supplies the data; the inline defaults keep the function usable without one.
  const pack = opts.pack === undefined || opts.pack === null ? null : opts.pack
  const metrics = opts.metrics === undefined ? (pack === null ? DEFAULT_METRICS : pack.metrics) : opts.metrics
  const live = opts.live === undefined ? (pack === null ? DEFAULT_LIVE_VARS : pack.liveVars) : opts.live
  const minSources = pack === null || pack.thresholds === undefined ? 3 : pack.thresholds.minSources
  const minRuns = pack === null || pack.thresholds === undefined ? 3 : pack.thresholds.minRuns
  // `rules` selects; it never describes. Anything richer belongs in code, not in data.
  const enabled = new Set(pack === null || !Array.isArray(pack.rules) ? ['R1', 'R2', 'R3', 'R4', 'R5'] : pack.rules)
  const fails = []
  const warns = []
  if (v === undefined || v === null) return { fails: ['[R0-SHAPE] no verdict object'], warns, pass: false }

  const polarity = String(v.polarity === undefined ? 'neutral' : v.polarity).toLowerCase()
  const sources = Array.isArray(v.sources) ? v.sources : []
  const urls = new Set(sources.map((s) => (s && s.url ? s.url : null)).filter((u) => u !== null))

  if (enabled.has('R1') && urls.size < minSources) {
    fails.push('[R1-SOURCES] ' + urls.size + ' distinct source(s); this pack requires at least ' + minSources)
  }

  const probe = v.same_model_positive_search === undefined || v.same_model_positive_search === null ? {} : v.same_model_positive_search
  if (enabled.has('R2') && polarity === 'negative') {
    if (probe.done !== true) {
      fails.push('[R2-POSITIVE] a negative claim must record same_model_positive_search.done=true')
    }
    if (typeof probe.hits === 'number' && probe.hits > 0) {
      fails.push('[R2-POSITIVE] the same-model search found ' + probe.hits + ' counter-example(s); state a condition, not an impossibility')
    }
  }

  for (const name of enabled.has('R3') && Array.isArray(v.metrics) ? v.metrics : []) {
    const entry = metrics[name]
    if (entry === undefined) {
      fails.push('[R3-METRIC] ' + name + ' is not registered (this is how a wrong quantity becomes a wrong conclusion)')
    } else if (entry.status === 'deprecated_as_sole_criterion') {
      fails.push('[R3-METRIC] ' + name + ' is registered as unfit to stand alone')
    }
  }

  const contrast = v.contrast === undefined || v.contrast === null ? {} : v.contrast
  for (const name of enabled.has('R4') && Array.isArray(contrast.diff_vars) ? contrast.diff_vars : []) {
    const entry = live[name]
    const status = entry === undefined ? 'UNKNOWN' : entry.status
    if (status !== 'LIVE') {
      fails.push('[R4-LIVEVAR] the arms differ on ' + name + ' whose liveness is ' + status + ' - that is a false contrast')
    }
  }

  const repro = v.repro === undefined || v.repro === null ? {} : v.repro
  if (enabled.has('R5')) {
    if (!repro.cmd) fails.push('[R5-REPRO] missing repro.cmd')
    if (!repro.observed) fails.push('[R5-REPRO] missing repro.observed')
  }

  const tested = v.tested === undefined || v.tested === null ? {} : v.tested
  if (typeof tested.runs !== 'number' || tested.runs < minRuns) {
    warns.push('ran ' + tested.runs + ' time(s); this pack asks for at least ' + minRuns)
  }

  return { fails, warns, pass: fails.length === 0 }
}
