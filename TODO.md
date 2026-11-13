# TODO

State at 2026-11-13. Every item carries a criterion; an item without one is a wish.

## Now

- [ ] **Collect 30 labelable hits and have two people label them** - the tooling exists
      (`scripts/labelled-corpus.mjs --export / --score`) and the pipeline was proven end to end on
      2026-11-13: a probe write produced one audit line carrying the word, the path and the snippet.
      What remains is data and judgement, not code. Criterion: precision and Cohen's kappa printed
      with intervals and their n.

## Done

- [x] **Steering is reachable, and pinned by two tests** - `steerAtTurnEnd` could never fire with the
      default `maxPerTurn: 1`: the mid-turn reminder moved the hit into a state the close boundary
      never read. The hit now survives the reminder in its own field, a monitored write to the same
      path without the trigger word clears it, and the close boundary objects to whichever of the two
      is still pending. Both ends have a test, and reverting the fix was observed to fail the first
      one by name.

- [x] **The public text now says what the code does** - eleven claims corrected at the source after a
      read-only audit: "before it writes" became mode-qualified, "no files, no persistence" became
      "reads its pack and skill, appends only when auditPath is set", the skill stopped promising a
      CLI gate it does not ship, the glossary stopped calling a stored status a proof, and both paper
      citations regained the conditions their abstracts state. DECISIONS A1 also records that this
      repository ships one implementation and that the crosscheck is a local check.

- [x] **The hygiene gate caught its own author** - the A1 rewrite quoted a local drive path, and
      `S2 no local drive path in public text` failed on it. That is the gate working on the person
      writing the gate; the commit was amended rather than pushed red.

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
      `scripts.test` from package.json. That fixed drift between the runner and the suite, not between
      the repository and the tarball: two test files were missing from `files[]`, so the published
      package ran 52 of 66 tests and pack-verify could not tell. Both are fixed now.

- [x] **Mutation re-measured after the steering change** - 63.08% over 1189 mutants (750 killed / 439
      survived), 3 min 34 s. The mutant population grew from 1095 when `index.js` changed, so the drop
      from 63.84% is not a regression - a percentage over a different mutant set is a different
      measurement, and comparing the two as if they were one number would be the error this file keeps
      recording.
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
