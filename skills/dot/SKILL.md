---
name: dot
description: |
  Check a conclusion before it becomes a document. Use when about to write a claim that
  a model, tool or method *cannot* do something, when accepting a rule or changing a
  default, or when releasing. Runs a machine-checkable gate over sources, counter-examples,
  registered quantities, contrast liveness and reproducibility. Not for routine edits, not
  for a single run's observation, and not a substitute for reading the output.
---

# dot

A conclusion in a document outlives the evidence it was based on. This skill exists
to make the evidence check happen before the sentence is written, not after someone
notices the sentence is wrong.

## When to run it

- **Before a negative capability claim.** "This model cannot do X" is the most
  expensive sentence a working document can hold, and the cheapest to get wrong.
- **Before admitting a rule or changing a default.** A rule that came from a
  hypothetical will be re-read as if it came from a measurement.
- **Before releasing.** Publishing fixes a version number permanently.

Do **not** run it for a single run's observation. "Run 3 produced 0.79" is data, not
a claim about ability, and dressing it up as one is the failure this skill targets.

## The loop

1. **Collect before concluding.**
   - At least three distinct source URLs. The gate counts distinct URLs only:
     independence and recency are your judgement, not something it can check.
   - For a negative claim, record the counter-example search: query the same model's
     own documentation and its field reports before generalising. One community post
     is not a survey.
2. **Name the quantity you measured.** Use a registered name. An unregistered name is
   how a wrong measurement becomes a wrong conclusion, and a quantity that cannot
   stand alone must not be the only support.
3. **Check that the contrasted variable is live.** Two arms that differ only on a
   parameter the model ignores were never contrasted, however clean the wording.
4. **Write down the re-run.** A command plus an observed value, or it did not happen.
5. **Gate the conclusion.** Use whatever the project already keeps. `checkVerdict` in
   this package returns `{ pass, fails, warns }`; a project with its own CLI gate may
   express the same thing as exit 0 / 1 / 2. Exit 2 means it could not run - that is
   not a pass.

## Shape of a verdict

```json
{
  "claim": "what is being asserted",
  "polarity": "negative | observation | neutral",
  "sources": [{ "url": "...", "kind": "vendor | same_model_test | paper | community" }],
  "same_model_positive_search": { "done": true, "hits": 0 },
  "metrics": ["registered.quantity"],
  "contrast": { "arms": ["a", "b"], "diff_vars": ["live.variable"] },
  "repro": { "cmd": "...", "observed": "..." },
  "tested": { "runs": 3 }
}
```

`polarity: negative` carries the heaviest burden: it asserts a limit on what a thing
can do. `observation` asserts nothing beyond one run. Mixing the two is how a single
bad run becomes a permanent rule.

## Admission rule for a new rule

A rule enters only if all four hold:

1. An observed failure with three fields: what ran, what happened, what was expected.
2. Not a personal preference. Taste belongs in configuration or a fork.
3. Not a special case for one machine, model or profile.
4. A re-runnable check. Without one it can be a warning at most, never a failure.

Rules are written as samples first and code second.

## Done

- The gate exits 0, and you can say which source, which quantity and which run each
  sentence rests on.
- If the gate cannot run, the conclusion stays unwritten.
