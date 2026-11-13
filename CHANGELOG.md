# Changelog

## 0.1.0

First release.

- Watches `write` / `edit` calls into configured paths and injects one reminder
  when the written body contains a negative capability phrase.
- Trigger is the action, not a tool-call counter.
- Ships a `dot` skill and registers it through `ctx.skills.registerProvider()`.
- Configured by `cordis.patch.yml`; no timers, no polling, no persistence.
