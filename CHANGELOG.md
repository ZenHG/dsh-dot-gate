# Changelog

## Unreleased

- Ignores trigger words inside backticks, and words immediately wrapped in a quote
  character. It does not track balanced quotation pairs: a quoted sentence still fires.
- `auditPath`: optional JSONL log, one line per hit, carrying a clipped copy of the
  matching text so a hit can be labelled afterwards. Empty by default.
- `steerAtTurnEnd`: object once at the close boundary when a reminded hit was never
  rewritten without the trigger word. Before this change the mid-turn reminder cleared
  the hit, so the objection could only fire with `maxPerTurn: 0` - it now fires in the
  documented case, and two tests hold both ends of it.

## 0.0.1

Name reservation release. The behaviour described below ships as-is; 0.0.1 exists so
the package name is held. Interfaces may change before 0.1.0.

## 0.1.0 (unreleased)

Planned first release. Nothing is published under this number yet - `npm view` shows
only `0.0.0-stage` and `0.0.1`.

- Watches `write` / `edit` calls into configured paths and injects one reminder
  when the written body contains a negative capability phrase.
- Trigger is the action, not a tool-call counter.
- Adds an opt-in `hardMode`: a `tools/pre-execute` guard that refuses the write instead of
  reminding afterwards.
- Ships a `dot` skill and registers it through `ctx.skills.registerProvider()`.
- Configured by `cordis.patch.yml`; no timers, no polling, no persistence.
