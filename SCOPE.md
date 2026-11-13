# Scope

What this plugin is for, and what it will not become.

## The bar

A rule, a default, or a behaviour is added only if it clears all four:

1. **Observed failure.** It describes something that actually went wrong: what
   was run, what happened, what was expected. A hypothetical improvement does
   not clear this.
2. **Not a personal preference.** Taste belongs in `cordis.patch.yml` config or
   in a fork, not in the defaults.
3. **Not a harness special case.** No branches for one profile, one machine, or
   one model.
4. **A re-runnable check.** If it cannot come with a command and an observed
   value, it can be a warning at most, never a failure.

Rules are written as samples first and code second. See `test.mjs`.

## Out of scope

Each rejected direction gets one file in [`.out-of-scope/`](./.out-of-scope/).
Read them before proposing something.

- [Average-accuracy acceptance](./.out-of-scope/average-accuracy-acceptance.md)

## Non-goals

- **It does not judge your claims.** Whether a claim is well-evidenced is a
  policy question about your project. The plugin only refuses to let it pass
  silently.
- **It does not block.** No exit codes, no reverts, no rejected calls. A gate
  that can break someone's workflow gets uninstalled in a week.
- **No network, no files, no persistence.** It reads tool arguments in memory
  and nothing else.
- **No model-specific tuning.** Phrases are configuration, not code.
