# TODO

State at 2026-11-13. Every item carries a criterion; an item without one is a wish.

## Now

- [ ] **Confirm `agent/turn-stopping` steering in a live turn** - the code path is tested but no real
      turn has been observed taking the extra step. Criterion: one real turn shows it.

## Next

- [ ] **Labelled corpus** - 30 real hits from `auditPath`, labelled by two raters; report
      precision, recall and Cohen's kappa with intervals.

## Done

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
