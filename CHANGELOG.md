# Changelog

## Unreleased

- Ignores trigger words inside backticks and paired quotes: a document that describes
  this plugin mentions the words, it does not assert them.
- `auditPath`: optional JSONL log, one line per hit. Empty by default.
- `steerAtTurnEnd`: object once at the close boundary when a hit was never addressed,
  so the turn cannot end as if the claim had been checked.

## 0.0.1

Name reservation release. The behaviour described below ships as-is; 0.0.1 exists so
the package name is held. Interfaces may change before 0.1.0.

## 0.1.0

First release.

- Watches `write` / `edit` calls into configured paths and injects one reminder
  when the written body contains a negative capability phrase.
- Trigger is the action, not a tool-call counter.
- Adds an opt-in `hardMode`: a `tools/pre-execute` guard that refuses the write instead of
  reminding afterwards.
- Ships a `dot` skill and registers it through `ctx.skills.registerProvider()`.
- Configured by `cordis.patch.yml`; no timers, no polling, no persistence.
