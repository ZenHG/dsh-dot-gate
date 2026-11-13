# TODO

State at 2026-11-13. Every item carries a criterion; an item without one is a wish.

## Now

- [ ] **Mutation testing** (`npx stryker run`) - criterion: a score is reported. Below ~60%
      the suite is decoration, and that gets fixed before any new feature.
- [ ] **Property-based tests** (`fast-check`) - criterion: these invariants hold over randomised
      verdicts: (a) zero distinct sources never passes, (b) an unregistered quantity never passes,
      (c) a rule that is switched off cannot produce a failure, (d) unknown atoms are always refused.
- [ ] **False-positive report routine** - criterion: one weekly message with hits, denials and how
      they split, readable without opening the code.

## Next

- [ ] **Domain pack generator** (read-only subagent) - takes a domain description, emits a pack
      draft, a skill draft and a sample set. Criterion: a human reviews one artefact, not source.
- [ ] **Confirm `agent/turn-stopping` steering in a live turn** - the code path is tested but no real
      turn has been observed taking the extra step. Criterion: one real turn shows it.
- [ ] **Labelled corpus** - 30 real hits from `auditPath`, labelled by two raters; report
      precision, recall and Cohen's kappa with intervals.

## Deliberately not doing

See `SCOPE.md` non-goals. Short version: no client UI, no prebuilt native binary, no rules
referencing rules, no model-authored rules.
