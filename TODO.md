# TODO

State at 2026-11-13. Every item carries a criterion; an item without one is a wish.

## Now

- [ ] **Cover the ten survivors that the score alone does not catch.** The score is 60.80% (650
      killed / 419 survived of 1069) once the mutation run uses the same command as `npm test`. With a
      hard-coded three-file command it read 57.06%, because the property suite was left out of the score
      entirely. Clearing the 60% line is not the same as being safe - these ten are behaviour changes
      the suite still does not catch, each replayed by hand:
      `runs >= minRuns` tightened to `>` (`evaluate.mjs:68`); `counter_search_done` forced
      to return false (`evaluate.mjs:50`); `minSources < 1` rejecting a legal 1 (`pack.mjs:60`);
      `minRuns < 1` the same (`pack.mjs:61`); an empty `checks: []` accepted (`pack.mjs:42`); a pack
      with no `rules` key accepted, after which everything passes (`pack.mjs:64`); `probe.hits > 0`
      loosened to `>=` (`evaluate.mjs:54`); `maxPerTurn < 0` rejecting 0 (`index.js:132`);
      `words.some` degraded to `every` (`index.js:129`); the interpreter's unknown-atom fallback
      answering true (`evaluate.mjs:71`). Criterion: each of the ten has a test that goes red when the
      mutation is replayed.

## Next

- [ ] **Domain pack generator** (read-only subagent) - takes a domain description, emits a pack
      draft, a skill draft and a sample set. Criterion: a human reviews one artefact, not source.
- [ ] **Confirm `agent/turn-stopping` steering in a live turn** - the code path is tested but no real
      turn has been observed taking the extra step. Criterion: one real turn shows it.
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
