// SPDX-License-Identifier: MIT
/**
 * evaluate.mjs - run a pack's rule expressions.
 *
 * The vocabulary is closed on purpose. A pack composes atoms; it cannot invent one. That
 * boundary is what lets the same data drive two independent implementations without turning
 * into a rule engine: the interpreter is small and fixed, the composition is data.
 *
 * Deliberately absent: rules referring to other rules. The moment a rule needs another
 * rule's outcome, this is a state machine, not a checker - a different decision entirely.
 */

/** Every atom the interpreter knows. A pack naming anything else is refused at load. */
export const ATOMS = new Set([
  'sources>=minSources',
  'counter_search_done',
  'counter_search_clear',
  'metric_registered',
  'metric_not_deprecated',
  'var_live',
  'repro_present',
  'runs>=minRuns',
])

/** Where an atom may read, so a pack cannot point the interpreter at arbitrary structure. */
export const OVER_PATHS = new Set(['metrics', 'contrast.diff_vars'])

function readPath(value, path) {
  let cur = value
  for (const key of path.split('.')) {
    if (cur === undefined || cur === null) return undefined
    cur = cur[key]
  }
  return cur
}

function sourcesOf(v) {
  const list = Array.isArray(v.sources) ? v.sources : []
  return new Set(list.map((s) => (s && typeof s.url === 'string' && s.url !== '' ? s.url : null)).filter((u) => u !== null))
}

/** One atom against one item (or against the verdict itself when there is no \`over\`). */
function atomHolds(atom, item, context) {
  const { pack, verdict } = context
  switch (atom) {
    case 'sources>=minSources':
      return sourcesOf(verdict).size >= pack.thresholds.minSources
    case 'counter_search_done': {
      const probe = verdict.same_model_positive_search ?? {}
      return probe.done === true
    }
    case 'counter_search_clear': {
      const probe = verdict.same_model_positive_search ?? {}
      return !(typeof probe.hits === 'number' && probe.hits > 0)
    }
    case 'metric_registered':
      return Object.prototype.hasOwnProperty.call(pack.metrics, String(item))
    case 'metric_not_deprecated':
      return (pack.metrics[String(item)] ?? {}).status !== 'deprecated_as_sole_criterion'
    case 'var_live':
      return (pack.liveVars[String(item)] ?? {}).status === 'LIVE'
    case 'repro_present': {
      const repro = verdict.repro ?? {}
      return typeof repro.cmd === 'string' && repro.cmd !== '' && repro.observed !== undefined && repro.observed !== null && String(repro.observed) !== ''
    }
    case 'runs>=minRuns': {
      const tested = verdict.tested ?? {}
      return typeof tested.runs === 'number' && tested.runs >= pack.thresholds.minRuns
    }
    default:
      return false
  }
}

const MESSAGES = {
  'sources>=minSources': (rule, pack, item, v) =>
    '[' + rule + '-SOURCES] ' + sourcesOf(v).size + ' distinct source(s); this pack requires at least ' + pack.thresholds.minSources,
  counter_search_done: (rule) => '[' + rule + '-POSITIVE] a negative claim must record same_model_positive_search.done=true',
  counter_search_clear: (rule, pack, item, v) =>
    '[' + rule + '-POSITIVE] the same-model search found ' + ((v.same_model_positive_search ?? {}).hits) + ' counter-example(s); state a condition, not an impossibility',
  metric_registered: (rule, pack, item) => '[' + rule + '-METRIC] ' + item + ' is not registered (this is how a wrong quantity becomes a wrong conclusion)',
  metric_not_deprecated: (rule, pack, item) => '[' + rule + '-METRIC] ' + item + ' is registered as unfit to stand alone',
  var_live: (rule, pack, item) => '[' + rule + '-LIVEVAR] the arms differ on ' + item + ' whose liveness is ' + ((pack.liveVars[String(item)] ?? {}).status ?? 'UNKNOWN') + ' - that is a false contrast',
  repro_present: (rule) => '[' + rule + '-REPRO] missing repro.cmd or repro.observed',
  'runs>=minRuns': (rule, pack, item, v) =>
    '[' + rule + '-RUNS] ran ' + ((v.tested ?? {}).runs) + ' time(s); this pack asks for at least ' + pack.thresholds.minRuns,
}

function applies(rule, verdict) {
  const when = rule.when ?? 'always'
  const negative = String(verdict.polarity ?? 'neutral').toLowerCase() === 'negative'
  if (when === 'always') return true
  if (when === 'negative') return negative
  if (when === 'non-negative') return !negative
  return false
}

function runSection(section, pack, verdict) {
  const out = []
  for (const ruleId of Object.keys(section)) {
    const rule = section[ruleId]
    if (!applies(rule, verdict)) continue
    for (const check of rule.checks) {
      if (check.over === undefined) {
        if (!atomHolds(check.atom, undefined, { pack, verdict })) {
          out.push(MESSAGES[check.atom](ruleId, pack, undefined, verdict))
        }
        continue
      }
      const list = readPath(verdict, check.over)
      const items = Array.isArray(list) ? list : []
      for (const item of items) {
        if (!atomHolds(check.atom, item, { pack, verdict })) {
          out.push(MESSAGES[check.atom](ruleId, pack, item, verdict))
        }
      }
    }
  }
  return out
}

export function evaluate(pack, verdict) {
  const v = verdict === undefined || verdict === null ? {} : verdict
  const fails = runSection(pack.rules ?? {}, pack, v)
  const warns = runSection(pack.warnings ?? {}, pack, v)
  return { fails, warns, pass: fails.length === 0 }
}
