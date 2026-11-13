# TODO

State at 2026-11-13. Every item carries a criterion; an item without one is a wish.

## Now

- [ ] **Grow n before deciding the release, not change the detector** - on the population the gate
      actually evaluates (writes under `Wiki/`), the replayed precision is **77.8% [54.8, 91.0] with
      recall 87.5%**, at the 70% bar. The interval is wide because that population is only 18 rows.
      Every structural attempt to raise precision made recall worse (see Done), so the next honest move
      is more rows, not a cleverer matcher. Criterion: 60+ real `Wiki/` hits labelled, the interval
      narrowed, and the release decision restated against the new interval rather than the point.

- [ ] **Get a second human rater for kappa** - the 84 labels came from one blind rater. Precision has
      an interval; agreement does not exist yet. Criterion: two raters over the same sheet, Cohen's
      kappa printed with its n.

## Done

- [x] **Adherence to the evidence checklist, measured against a control** - the papers this project
      cites measure *adherence to a prescribed procedure*, not trigger precision, so this is the
      experiment that actually answers "does it work for the reason SIGIL says it works". Two groups
      of knowledge-base sentences, scored blind on the five things the reminder asks for (sources,
      counter-example search, named metric, live-variable statement, reproduction) by a rater who
      never saw the grouping:

      | group | n | mean items /5 | >=3 items | all 5 |
      |---|---:|---|---|---|
      | contains a trigger word | 27 | 1.70 | 40.7% [24.5, 59.3] | 0/27 |
      | makes the same kind of limitation, no trigger word | 32 | 1.69 | 28.1% [15.6, 45.4] | 2/32 |

      Difference in mean items **+0.02, 95% bootstrap [-0.82, +0.84]**. The two groups cannot be told
      apart. Overall only 2 of 59 passages carry all five, and `counter` appears in just 4.

      **What this does and does not say.** The knowledge base is almost entirely older than the gate -
      it was installed on 2026-11-13 - so this is a *level*, not an effect; it cannot show that the
      gate fails to raise adherence, only that nothing here has been raised yet. What it does show is
      sharper than the earlier precision work: the trigger words do **not** select for unusually
      under-evidenced claims (40.7% vs 28.1%, intervals overlapping), so the word list is not
      identifying a distinct failure population - which is the assumption the whole mechanism rests on.

- [x] **The mechanism matches the papers' shape, and none of their evidence** - checked against the
      five abstracts rather than against what was remembered about them. SIGIL and SkillCompiler both
      describe a typed intermediate form that is validated, then executed deterministically, with the
      interpretive part left to the model; the pack and its closed vocabulary implement exactly that
      shape. But SIGIL *compiles* a harness from the representation while this project *interprets*
      the pack with fixed code, so the representation is far thinner - adding a ninth atom is a code
      change. Harness Engineering is cited for the right warning (its deterministic layer helped in
      one of four cells and hurt in two) but its measurement was never replicated here. The
      More Skills citation supports a closed vocabulary only by analogy: a 202-skill library the agent
      chooses from is not the same object as an eight-predicate rule language. And Regression Tax -
      whether adding the gate makes some tasks *worse* - has not been attempted at all. Conclusion:
      shape conforms, evidence does not.

- [x] **Mention detection was tried, measured four ways, and reverted** - the hypothesis was that the
      false positives are structural mentions (code spans, fenced blocks, balanced quotations) and that
      fixing `isQuoted` would move the number. It did, in the wrong direction. Replaying the same 84
      full texts through the real plugin:

      | variant | fires | precision | recall |
      |---|---:|---|---|
      | original adjacency rule | 67 | 55.2% [43.4, 66.5] | 88.1% |
      | fenced blocks + inline code | 78 | 51.3% [40.4, 62.1] | 95.2% |
      | + balanced quotations | 49 | 63.3% [49.3, 75.3] | 73.8% |
      | + quotations, scan window 300 | 63 | 54.0% [41.8, 65.7] | 81.0% |
      | fenced blocks + original rule | 79 | 51.9% [41.1, 62.6] | 97.6% |

      Only the aggressive variant gained precision, and it paid 14 points of recall to do it while
      still missing the 70% bar. Two things this exposed: the original rule's apparent precision came
      largely from a bug (odd-count backtick parity) that accidentally suppressed code-heavy messages,
      and the real false positives are **semantic** - `如果 ② 做不到完整`, `才说做不到`,
      `没有它哪件事做不到` are conditionals, meta-rules and questions, which no regex separates from a
      claim. Reverted; the file is byte-identical to before the experiment.

- [x] **The previous precision number was measuring the wrong population** - 50.0% (and 61.5% for wiki
      lines) counted every row in the corpus. But the gate only ever evaluates writes under `Wiki/`;
      session messages are rows it never sees. Restricted to the rows it actually fires on, replayed
      end to end: all rows 55.2% [43.4, 66.5]; **wiki rows 77.8% [54.8, 91.0], recall 87.5%, n=18**;
      session rows 46.9% [33.7, 60.6]. The lower numbers were real but answered a question nobody
      asked. Corrected here rather than quietly dropped.

- [x] **The history was enough: a first precision number, out of data already on disk** - 240 stored
      sessions, 17,512 messages and 15,521 tool calls were already there, so the corpus never had to
      wait a week. They were read through the session-query index, because the session files are
      multi-frame zstd (8,776 frames each) and Node's decoder stops after the first. 89 candidate
      occurrences of a trigger phrase, 84 after de-duplication, 26 of them lines in `Wiki/` - the
      population closest to what the gate actually sees. One blind rater labelled all 84 against a
      written codebook: wiki lines **61.5% [42.5, 77.6]**, session messages **44.8% [32.7, 57.5]**,
      everything **50.0% [39.5, 60.5]**. Below the 70% bar, so 0.1.0 stays unpublished.
      Two ideas died here. Narrowing the word list does nothing (61.5% -> 60.9%). And the history
      cannot yield the gate's real hit log: most writes go through `run_code`, and across all 240
      sessions only **5** direct `write`/`edit` calls touch `Wiki/`. Those hits were never recorded,
      so this measures phrase precision on real text, not the hit log - stated that way on purpose.

- [x] **The corpus builder had a bug, and the rater caught it** - the first sheet truncated every
      session message to its first 260 characters, so in 54 of 62 rows the trigger word was not inside
      the snippet being judged. The rater refused to guess and returned UNCLEAR, which is what exposed
      it. Rebuilt with a 120-character window centred on the word, the same budget `snippetOf` uses.

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
