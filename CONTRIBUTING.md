# Contributing

Start with [PROCESS.md](./PROCESS.md) — it is the whole path, not just this page.

## Adding a rule

1. **Write the failure first.** Add a sample under `test.mjs` that reproduces the
   thing that went wrong. It must fail before your change.
2. **Say what was observed.** What was run, what happened, what was expected.
   Numbers, not adjectives.
3. **Add the smallest check that catches it.** Not a framework.
4. **Run `npm test` and `node scripts/hygiene.mjs`.** Both must pass.
5. **If the rule cannot produce a re-runnable check**, it is not a rule. File it
   under `.out-of-scope/` with the reason.

## Changing a default

Only when the current default produced an observed failure. Personal taste goes
in `cordis.patch.yml`, which is what configuration is for.

## Style

- Plain ES modules, no build step, no dependencies.
- Every `.js` / `.mjs` starts with `// SPDX-License-Identifier: MIT`.
- No timers, no polling. I/O is limited to reading the pack and the skill, plus the
  opt-in audit append. A plugin that costs nothing when idle is a plugin people leave
  installed.

## Rules of evidence

Three habits that each cost a real debugging session before they became rules.

1. **Never pipe a gate.** `node scripts/hygiene.mjs | tail -5` shows you the
   output and throws away the exit code. A pipeline reports the exit status of
   the last command, not the gate. Run it bare and read the code.
2. **A skipped gate is not a passing gate.** Exit `2` means *not fully run*.
   `--require-all` turns every skip into a failure. Never describe a run that
   printed `SKIP` as green.
3. **Stage before you check.** The gate reads the git index, not the disk,
   because the index is what would ship. Untracked files are invisible to it -
   and an invisible file is how a local path reaches a release.

## Numbers in documents

If a number cannot be produced by a gate, do not write it in prose. Counts of
files, tests, or examples drift the moment someone runs `npm test`. Point at the
command instead of restating its output.
