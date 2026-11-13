// SPDX-License-Identifier: MIT
/**
 * test-property.mjs - the pack's invariants, quantified over generated packs and evidence.
 *
 * test.mjs / test-verdict.mjs pin down the cases someone thought of. These four properties
 * cover the rest of the input space: packs and evidence are built through the same schema
 * validatePack enforces, then each claim is checked over hundreds of random samples.
 *
 * Two of the four claims are NOT true of *every* schema-valid pack, and the code says so:
 * a pack may compose no sources rule at all (pack.mjs only asks that rules be an object),
 * and a rule whose when does not match the verdict is skipped (evaluate.mjs applies()).
 * Those properties therefore state the precondition the interpreter actually needs instead
 * of asserting a wider claim than the code makes. See the comment above each test.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import { checkVerdict } from './src/verdict.mjs'
import { validatePack, PACK_SCHEMA_VERSION } from './src/pack.mjs'

/** Samples per property. Four properties at 500 = 2000 randomised packs/verdicts. */
const RUNS = 500

/** Every status validatePack accepts, for either registry (pack.mjs KNOWN_STATUSES). */
const STATUSES = [
  'active',
  'active_with_caveat',
  'deprecated_as_sole_criterion',
  'LIVE',
  'DEAD',
  'UNKNOWN',
  'TESTED_WEAK',
]
const WHEN = ['always', 'negative', 'non-negative']

const arbWhen = fc.constantFrom(...WHEN)

/** A rule object as validateSection expects it: an optional when, a non-empty checks list. */
const ruleWith = (when, checks) => (when === 'always' ? { checks } : { when, checks })

/** A registry: unique keys mapped to an accepted status, like packs/*.json carry. */
const arbRegistry = (prefix) =>
  fc
    .uniqueArray(
      fc.tuple(
        fc.string({ maxLength: 10 }).map((s) => prefix + s),
        fc.constantFrom(...STATUSES),
      ),
      { selector: (pair) => pair[0], maxLength: 5 },
    )
    .map((pairs) => Object.fromEntries(pairs.map(([key, status]) => [key, { status }])))

/** Evidence pieces: the shapes samples/*.json use, including the malformed ones. */
const arbUrl = fc.string({ maxLength: 10 }).map((s) => 'https://s.test/' + s)
const arbJunkSource = fc.constantFrom({}, { url: '' }, { url: 7 }, null)
const arbRepro = fc.constantFrom(
  {},
  { cmd: '', observed: '1' },
  { cmd: 'node run.mjs' },
  { cmd: 'node run.mjs', observed: '' },
  { cmd: 'node run.mjs', observed: null },
  { cmd: 'node run.mjs', observed: '0.79' },
  { cmd: 'node run.mjs', observed: 0 },
)
const arbTested = fc.constantFrom({}, { runs: 0 }, { runs: 1 }, { runs: 3 }, { runs: 9 }, { runs: '3' })
const arbProbe = fc.constantFrom(
  {},
  { done: true },
  { done: false },
  { done: true, hits: 0 },
  { done: true, hits: 2 },
  { done: 'true' },
  { hits: 1 },
)

/** At least one rule or warning is present, so "remove one rule" always has a target. */
const arbPresent = fc
  .record({
    R1: fc.boolean(),
    R2: fc.boolean(),
    R3: fc.boolean(),
    R4: fc.boolean(),
    R5: fc.boolean(),
    W1: fc.boolean(),
  })
  // At least one entry in `rules` (a warning alone would leave nothing to remove).
  .map((present) => (present.R1 || present.R2 || present.R3 || present.R4 || present.R5 ? present : { ...present, R1: true }))

/** Everything a pack varies, before it is assembled into the schema's shape. */
const arbPackShape = fc.record({
  name: fc.string({ minLength: 1, maxLength: 10 }),
  paths: fc.array(fc.string({ maxLength: 10 }), { maxLength: 2 }),
  words: fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 3 }),
  minSources: fc.integer({ min: 1, max: 5 }),
  minRuns: fc.integer({ min: 1, max: 5 }),
  metrics: arbRegistry('reg.'),
  liveVars: arbRegistry('var.'),
  present: arbPresent,
  whens: fc.record({ R1: arbWhen, R2: arbWhen, R3: arbWhen, R4: arbWhen, R5: arbWhen, W1: arbWhen }),
})

/**
 * Assemble a pack from the shape. Options force a rule into the section the property needs:
 * r1Always keeps the sources rule applicable, r3Always keeps the metric-registry rule applicable.
 */
function packFrom(shape, opts = {}) {
  const minSources = opts.minSources ?? shape.minSources
  const rules = {}
  const warnings = {}
  const metrics = { ...shape.metrics }

  if (opts.r1Always === true || shape.present.R1) {
    rules.R1 = ruleWith(opts.r1Always === true ? 'always' : shape.whens.R1, [{ atom: 'sources>=minSources' }])
  }
  if (shape.present.R2) {
    rules.R2 = ruleWith(shape.whens.R2, [{ atom: 'counter_search_done' }, { atom: 'counter_search_clear' }])
  }
  if (opts.r3Always === true) {
    rules.R3 = ruleWith('always', [
      { atom: 'metric_registered', over: 'metrics' },
      { atom: 'metric_not_deprecated', over: 'metrics' },
    ])
    // A registered metric that may stand alone: the non-vacuity witness for property 2.
    metrics['prop.active'] = { status: 'active' }
  } else if (shape.present.R3) {
    rules.R3 = ruleWith(shape.whens.R3, [
      { atom: 'metric_registered', over: 'metrics' },
      { atom: 'metric_not_deprecated', over: 'metrics' },
    ])
  }
  if (shape.present.R4) {
    rules.R4 = ruleWith(shape.whens.R4, [{ atom: 'var_live', over: 'contrast.diff_vars' }])
  }
  if (shape.present.R5) {
    rules.R5 = ruleWith(shape.whens.R5, [{ atom: 'repro_present' }])
  }
  if (shape.present.W1) {
    warnings.W1 = ruleWith(shape.whens.W1, [{ atom: 'runs>=minRuns' }])
  }

  return {
    schemaVersion: PACK_SCHEMA_VERSION,
    name: 'property-' + shape.name,
    paths: shape.paths,
    words: shape.words,
    thresholds: { minSources, minRuns: shape.minRuns },
    rules,
    warnings,
    metrics,
    liveVars: shape.liveVars,
  }
}

/** A verdict whose cited names are drawn from the pack's registries or from outside them. */
function verdictFor(shape) {
  const names = (keys, prefix) =>
    keys.length === 0
      ? fc.string({ maxLength: 8 }).map((s) => prefix + s)
      : fc.oneof(...keys.map((key) => fc.constant(key)), fc.string({ maxLength: 8 }).map((s) => prefix + s))
  return fc.record({
    claim: fc.string({ maxLength: 10 }),
    polarity: fc.constantFrom('observation', 'negative', 'NEGATIVE', 'positive', 'neutral'),
    sources: fc.array(fc.oneof(arbUrl.map((url) => ({ url })), arbJunkSource), { maxLength: 5 }),
    metrics: fc.array(names(Object.keys(shape.metrics), 'q.'), { maxLength: 4 }),
    contrast: fc.record({ diff_vars: fc.array(names(Object.keys(shape.liveVars), 'q.'), { maxLength: 4 }) }),
    repro: arbRepro,
    tested: arbTested,
    same_model_positive_search: arbProbe,
  })
}

/**
 * (a) Zero distinct sources never passes.
 *
 * Restated from "any pack": a schema-valid pack may compose no sources rule at all, and
 * evaluate.mjs only runs rules the pack composes. So the claim the code makes is: when an
 * applicable sources rule exists, evidence whose distinct-source count is below the pack's
 * minSources cannot pass. The generator forces such a rule (r1Always), and both cases -
 * an empty/malformed list, and a list that is one URL repeated - are covered; the duplicate
 * case needs minSources >= 2 because a pack may legally require only one source.
 */
const arbZeroDistinctEvidence = fc.oneof(
  fc.record({
    kind: fc.constant('empty'),
    minSources: fc.integer({ min: 1, max: 5 }),
    entries: fc.array(arbJunkSource, { maxLength: 5 }),
  }),
  fc.record({
    kind: fc.constant('duplicates'),
    minSources: fc.integer({ min: 2, max: 5 }),
    url: arbUrl,
    copies: fc.integer({ min: 1, max: 6 }),
    entries: fc.array(arbJunkSource, { maxLength: 3 }),
  }),
)

function zeroDistinctSources(c) {
  if (c.kind === 'empty') return c.entries
  return [...Array.from({ length: c.copies }, () => ({ url: c.url })), ...c.entries]
}

test('property (a): below minSources distinct sources never passes', () => {
  fc.assert(
    fc.property(arbZeroDistinctEvidence, arbPackShape, (evidence, shape) => {
      const pack = validatePack(packFrom(shape, { r1Always: true, minSources: evidence.minSources }))
      const rest = {
        claim: 'p',
        polarity: 'observation',
        metrics: [],
        contrast: { diff_vars: [] },
        repro: { cmd: 'node run.mjs', observed: '0.79' },
        tested: { runs: 3 },
        same_model_positive_search: {},
      }

      const denied = checkVerdict({ ...rest, sources: zeroDistinctSources(evidence) }, { pack })
      assert.equal(denied.pass, false, 'a source-deficient verdict passed')
      assert.ok(
        denied.fails.some((m) => m.includes('R1-SOURCES')),
        'no sources failure was recorded: ' + denied.fails.join(' | '),
      )

      // Not vacuous: the same pack accepts a list of exactly minSources distinct URLs.
      const adequate = checkVerdict(
        {
          ...rest,
          sources: Array.from({ length: evidence.minSources }, (_, i) => ({ url: 'https://ok.test/' + i })),
        },
        { pack },
      )
      assert.ok(
        !adequate.fails.some((m) => m.includes('R1-SOURCES')),
        'the sources rule also rejected an adequate list: ' + adequate.fails.join(' | '),
      )
    }),
    { numRuns: RUNS },
  )
})

/**
 * (b) An unregistered quantity never passes.
 *
 * Restated from "any pack" for the same reason as (a): the check happens because the pack
 * composes metric_registered over metrics; a pack without that rule passes unregistered
 * names (only metric_not_deprecated is reached, and it treats an unknown key as not-deprecated).
 * The claim the code makes is: with that rule applicable, any cited name absent from
 * pack.metrics fails. The generator forces the rule and cites names under a prefix no
 * registry key can collide with.
 */
const arbUnregisteredName = fc.string({ maxLength: 8 }).map((s) => 'unknown.' + s)

test('property (b): a cited quantity outside the pack registry never passes', () => {
  fc.assert(
    fc.property(arbPackShape, fc.array(arbUnregisteredName, { minLength: 1, maxLength: 4 }), (shape, cited) => {
      const pack = validatePack(packFrom(shape, { r3Always: true }))
      const evidence = {
        claim: 'p',
        polarity: 'observation',
        sources: [{ url: 'https://a.test/1' }, { url: 'https://a.test/2' }, { url: 'https://a.test/3' }],
        metrics: cited,
        contrast: { diff_vars: [] },
        repro: { cmd: 'node run.mjs', observed: '0.79' },
        tested: { runs: 3 },
        same_model_positive_search: {},
      }

      const denied = checkVerdict(evidence, { pack })
      assert.equal(denied.pass, false, 'a verdict citing unregistered quantities passed')
      for (const name of cited) {
        assert.ok(
          denied.fails.some((m) => m.includes('-METRIC]') && m.includes(name)),
          'unregistered ' + JSON.stringify(name) + ' produced no metric failure: ' + denied.fails.join(' | '),
        )
      }

      // Not vacuous: a name that IS registered (and fit to stand alone) raises no such failure.
      const witness = checkVerdict({ ...evidence, metrics: ['prop.active'] }, { pack })
      assert.ok(
        !witness.fails.some((m) => m.includes('-METRIC]')),
        'a registered metric was rejected: ' + witness.fails.join(' | '),
      )
    }),
    { numRuns: RUNS },
  )
})

/**
 * (c) A switched-off rule cannot produce a failure.
 *
 * The schema has no enabled flag; the way a pack switches a rule off is to stop composing
 * it (test-pack.mjs does exactly that). Removing a rule from pack.rules therefore cannot
 * add a message: evaluate.mjs feeds each section rule into one conjunction, and pass is
 * fails.length === 0. The test checks the message multiset shrinks by exactly the removed
 * rule's messages, that warnings are untouched, and that pass is monotone.
 */
test('property (c): removing a rule only relaxes the verdict', () => {
  const arbPackAndVerdict = arbPackShape.chain((shape) => verdictFor(shape).map((verdict) => ({ shape, verdict })))
  const countByMessage = (messages) =>
    messages.reduce((counts, message) => counts.set(message, (counts.get(message) ?? 0) + 1), new Map())

  fc.assert(
    fc.property(arbPackAndVerdict, fc.nat({ max: 1000 }), ({ shape, verdict }, pick) => {
      const enabledPack = validatePack(packFrom(shape))
      const ids = Object.keys(enabledPack.rules)
      const removedId = ids[pick % ids.length]

      const disabledPack = structuredClone(enabledPack)
      delete disabledPack.rules[removedId]
      validatePack(disabledPack) // relaxing a pack must still leave a legal pack

      const compare = (evidence) => {
        const before = checkVerdict(evidence, { pack: enabledPack })
        const after = checkVerdict(evidence, { pack: disabledPack })

        assert.deepEqual(after.warns, before.warns, 'disabling a rule changed the warnings')
        const removedMessages = before.fails.filter((m) => m.startsWith('[' + removedId + '-'))
        assert.equal(
          after.fails.length,
          before.fails.length - removedMessages.length,
          'disabling ' + removedId + ' changed the failure count by more than its own messages',
        )
        const beforeCounts = countByMessage(before.fails)
        for (const [message, n] of countByMessage(after.fails)) {
          assert.ok((beforeCounts.get(message) ?? 0) >= n, 'disabling a rule invented a failure: ' + message)
        }
        assert.ok(!before.pass || after.pass, 'removing a rule turned a pass into a failure')
        return { before, after, removedMessages }
      }

      // 1. Random evidence from the generator.
      compare(verdict)

      // 2. Verdicts that fail every atom the pack can compose. No single polarity makes both
      //    a when="negative" and a when="non-negative" rule apply, so both are checked; the
      //    removed rule must have been speaking under one of them, or the arithmetic above is vacuous.
      const hostile = {
        claim: 'p',
        sources: [],
        metrics: ['unknown.all'],
        contrast: { diff_vars: ['unknown.all'] },
        repro: {},
        tested: { runs: 0 },
        same_model_positive_search: {},
      }
      const hostileNegative = compare({ ...hostile, polarity: 'negative' })
      const hostilePositive = compare({ ...hostile, polarity: 'positive' })
      assert.ok(
        hostileNegative.before.fails.length + hostilePositive.before.fails.length > 0,
        'no present rule spoke on the hostile verdicts',
      )
      assert.ok(
        hostileNegative.removedMessages.length + hostilePositive.removedMessages.length > 0,
        'the removed rule was silent on both hostile verdicts',
      )

      // 3. A verdict that satisfies every atom: disabling a rule cannot turn a pass into a failure.
      const friendly = compare({
        claim: 'p',
        polarity: 'observation',
        sources: Array.from({ length: shape.minSources }, (_, i) => ({ url: 'https://ok.test/' + i })),
        metrics: [],
        contrast: { diff_vars: [] },
        repro: { cmd: 'node run.mjs', observed: '0.79' },
        tested: { runs: shape.minRuns },
        same_model_positive_search: { done: true, hits: 0 },
      })
      assert.equal(friendly.before.pass, true, 'the friendly verdict did not pass: ' + friendly.before.fails.join(' | '))
      assert.equal(friendly.after.pass, true, 'removing a rule turned a pass into a failure')
    }),
    { numRuns: RUNS },
  )
})

/**
 * (d) Unknown atoms are always refused.
 *
 * validateSection rejects any atom not in ATOMS before a pack can be evaluated, whatever else
 * the pack contains. The generator first proves the unmutated pack validates, then injects a
 * name that cannot be in the closed set - inserted, replaced, or as a new rule, in either
 * section - and requires a TypeError naming the atom.
 */
const arbUnknownAtom = fc.string({ maxLength: 12 }).map((s) => 'not-an-atom.' + s)

test('property (d): an atom outside the closed set is always refused', () => {
  fc.assert(
    fc.property(
      arbPackShape,
      arbUnknownAtom,
      fc.constantFrom('rules', 'warnings'),
      fc.nat({ max: 99 }),
      (shape, atom, section, pick) => {
        const base = packFrom(shape)
        validatePack(base) // the throw below must be attributable to the injected atom

        const mutated = structuredClone(base)
        const target = mutated[section]
        const ids = Object.keys(target)
        const mode = pick % 3
        if (mode === 2 || ids.length === 0) {
          target.injected = { checks: [{ atom }] }
        } else {
          const id = ids[(pick >> 2) % ids.length]
          const checks = target[id].checks
          if (mode === 0) checks.splice(pick % (checks.length + 1), 0, { atom })
          else checks[pick % checks.length] = { atom }
        }

        assert.throws(
          () => validatePack(mutated),
          (err) =>
            err instanceof TypeError &&
            err.message.includes('.atom must be one of') &&
            err.message.includes('(got ' + JSON.stringify(atom) + ')'),
          'validatePack accepted an unknown atom',
        )
      },
    ),
    { numRuns: RUNS },
  )
})
