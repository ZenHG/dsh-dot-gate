# TODO

State at 2026-11-13. Every item carries a criterion; an item without one is a wish.

## Now

- [ ] **Confirm `agent/turn-stopping` steering in a live turn** - the code path is tested but no real
      turn has been observed taking the extra step. Criterion: one real turn shows it. The soft
      reminder, by contrast, was observed firing in a real turn on 2026-11-13: writing a trigger word
      under `Wiki/` produced the nudge inside the tool result.

- [ ] **Make the public text match the code.** A read-only audit of every user-facing file found flat
      contradictions, not hedges. In order of damage per line changed:
      (1) "check ... **before** it writes" (`README.md:3-4`, `package.json:4`, `index.js:3-4`) is false by
      default - `hardMode` is off, so the write lands first; qualify it with the mode.
      (2) "**No network, no files, no persistence.**" (`SCOPE.md:35-36`, `README.md:113-115`,
      `CONTRIBUTING.md:24-26`, `CHANGELOG.md:26`) is contradicted by `readFileSync` of the pack and the
      skill and by `appendFileSync` for `auditPath`; and "it never blocks" (`README.md:25`,
      `SCOPE.md:33`) is contradicted by hard mode's deny.
      (3) "if a hit was never addressed, object once at the close boundary" (`README.md:64`,
      `CHANGELOG.md:8-9`, `index.js:254-257`) - see the next item, which the audit measured.
      Also: `skills/dot/SKILL.md:41` promises gate exit codes 0/1/2 from a CLI the package does not ship,
      and `:31` promises "independent sources, each with a URL and a date" where `sourcesOf` counts
      distinct URLs only. Criterion: each claim is either true of the shipped default or qualified in
      one sentence, and no file states a capability the code lacks.

- [ ] **Fix or document that steering cannot fire in the default configuration.** `steerAtTurnEnd`
      is meant to object at the close boundary when a hit was never addressed. It cannot: the mid-turn
      reminder runs first and clears the hit (`index.js:287`), so turn-stopping finds nothing. Measured:
      default config gives 1 reminder and 0 steers; only `maxPerTurn: 0` with `steerAtTurnEnd: true`
      gives 1 steer. `test.mjs` calls turn-stopping without a pre-step, which is why the suite never
      saw it. Criterion: either the hit survives until the close boundary so the documented behaviour
      happens, or the docs say the two keys interact and the test pins that.

- [ ] **Collect 30 labelable hits and have two people label them** - the tooling exists
      (`scripts/labelled-corpus.mjs --export / --score`), so the remaining work is data and judgement,
      not code. Two things must happen first: the host must be restarted so the running plugin emits
      `snippet` (it is installed as a junction to this repo, so the files are already current on disk,
      but the process still has the old build in memory), and every hit collected before that restart
      is unusable for labelling because it has no text. Criterion: precision and Cohen's kappa printed
      with intervals and their n.

## Done

- [x] **Labelled-corpus tooling, and the snippet that makes a hit labelable** - a hit record carried a
      path and a word but not the text that triggered it, so nothing could be labelled after the fact.
      The audit line now carries a bounded, whitespace-flattened `snippet` taken from the exact
      `content`/`new_string` at hit time; it cannot fail a write. `scripts/labelled-corpus.mjs` exports a
      CSV two raters can fill in and scores it: precision and recall with Wilson intervals, Cohen's
      kappa with its n, disagreements counted rather than dropped, and recall reported as n/a when the
      sheet is hit-only. `--selftest` asserts the arithmetic including a hand-computed kappa.

- [x] **Mutation testing** - 60.80% over 1069 mutants, Stryker 10.1.1 driven through its `command`
      test runner, 169 s. The first reading of 57.06% was wrong in a way worth keeping: the runner's
      command was a hard-coded file list, so the property suite was never part of the score, and the
      property tests turned out to kill 40 more mutants (evaluate.mjs 67% -> 81%). The config now reads
      `scripts.test` from package.json, so the measured suite and the shipped suite cannot drift.
- [x] **Property-based tests** - `test-property.mjs`, four invariants over 2000 generated packs, 0.3 s.
      Two premises had to be restated because the code disagrees with them: as written, "zero sources
      never passes" and "an unregistered quantity never passes" are false for an arbitrary pack. A third
      was simply wrong - there is no `enabled` flag, so "switched off" can only mean removed.
- [x] **Domain pack generator** - `scripts/gen-pack.mjs` turns a five-minute domain description into a
      pack, six fixtures already evaluated against it, and a `REVIEW.md` checklist. It copies the default
      composition instead of authoring rules, refuses any atom outside the eight by name, requires an
      evidence floor, and validates the exact bytes it is about to write with the real `validatePack`.
      `--selftest` covers seven refusal paths. The criterion held: the human reviews the pack and the
      checklist, not the generator.
- [x] **The ten survivors have tests, each proven by replay** - apply the mutation, run
      `test-survivors.mjs`, see it go red, revert. Ten for ten, every run exited 1, every revert left a
      clean `git diff`. No `src/` change was needed: the defect was always in the tests. Score 63.84%
      (699 / 1095); a second run of the same tree gave 63.47%, so repeated runs differ by about four
      mutants and the number deserves one decimal, not three.
      Two corrections worth keeping: four of the ten had already been killed by the property suite, so
      60.80% was itself stale by the time it was written down; and every `pack.mjs` line number above
      moved when A7 landed (42/60/61/64 became 58/76/77/80), which is what happens to line numbers in a
      document that outlives the code.
- [x] **A pack without a sources rule is now refused** (DECISIONS.md A7). `thresholds.minSources` was
      mandatory while nothing applied it, so a pack could state an evidence floor and enforce none of
      it. `validatePack` now throws when no rule composes `sources>=minSources` without `over`; the
      Python gate returns the same error. A specified breaking change - no third-party packs exist yet.
- [x] **False-positive report routine** - `node scripts/audit-report.mjs --path <log> --since 7d`
      prints the split, the per-day rate and one decision sentence; `--selftest` asserts the arithmetic
      in memory, so the routine is checkable before a real log exists.

## Deliberately not doing

See `SCOPE.md` non-goals. Short version: no client UI, no prebuilt native binary, no rules
referencing rules, no model-authored rules.
