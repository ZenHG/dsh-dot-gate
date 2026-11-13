# Process

One page, one path. Every change to this package follows it, including changes made by an
agent. The point is not ceremony: each step exists because skipping it produced a mistake
that survived review.

## 0 · Is this worth doing at all

A change enters only if it clears all four bars in [SCOPE.md](./SCOPE.md): an observed
failure with three fields, not a personal preference, not a harness special case, and a
re-runnable check.

If it fails the fourth bar it can still be a warning, never a failure. If it fails the
first it is not a rule, it is a mood.

## 1 · Reproduce the failure first

Add a case to `test.mjs` that fails **before** the change. A rule written as a sample is a
claim about behaviour; a rule written as prose is a claim about intent.

If the failure cannot be reproduced, go back to step 0.

## 2 · Make the smallest change that catches it

Not a framework, not a config surface, not an abstraction in anticipation. The smallest
change that turns that one test green.

## 3 · Run the gates

```
npm run verify
  → secretlint        no credential in public text
  → publint           packaging resolves the way npm will read it
  → hygiene (7 gates) paths, identity, SPDX, packaging, skill frontmatter, commit history
  → npm test          the samples
  → pack-verify       the tarball works installed somewhere else
```

Exit 0 or it does not land. Exit 2 means a gate could not run — that is not a pass.

### Changing the judgement pack

The pack is data shared by both implementations. A change there is a change to `scope`, so:
bump `schemaVersion` only when the shape changes, and run `npm run crosscheck` afterwards -
it prints the pack hash, and a verdict disagreement after a pack edit is a drift signal, not
a test flake.

## 4 · Record it

- **Accepted**: an entry under `Unreleased` in [CHANGELOG.md](./CHANGELOG.md).
- **Rejected**: a file in [`.out-of-scope/`](./.out-of-scope/) saying what was rejected and
  what would reopen it.

  But only when it was a **considered direction**. The bar is: *could someone plausibly
  propose this again?* "We evaluated a rule engine and the rules never became complex
  enough to earn one" clears it. "We built a component before anything needed it, then
  deleted it" does not - that is a mistake, not a rejected direction, and writing it up
  dresses the mistake as a judgement call. The next reader would take it as deliberate.

## 5 · Release

Versions are never reused: a deleted version number cannot be published again. Publishing
on npm 11 goes through **staged publishing** — the tarball lands in a staging area with a
`0.0.0-stage` placeholder and needs maintainer approval before it is live. A successful
`npm publish` line is not proof of a published version; `npm view <pkg> versions --json` is.

## 6 · Retire rules

`auditPath` writes one JSONL line per hit. When a rule's false-positive share passes ten
percent, relax it; when a rule stops firing at all, delete it and record why in
`.out-of-scope/`. A rule set that only grows becomes the thing it was built to catch.

## Adding a skill

`skills/<name>/SKILL.md` with `name` and `description` in the frontmatter; gate S18 enforces
it. A new skill is only justified when the behaviour **cannot** be composed from an existing
one — that rule is borrowed from the repo this project's structure follows, and it is the
reason there is exactly one skill here.
