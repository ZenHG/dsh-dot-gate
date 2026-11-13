# Decisions

Numbered so later work can cite them, and so a reversal is visible rather than gradual.

Each entry carries four things: the decision, what it rests on, what it costs, and the
condition under which it should be reopened. **A decision without a reopen condition is a
belief, and beliefs get re-litigated every time someone new reads the code.**

Evidence is labelled so nobody has to guess how much weight it carries:

- `[权威]` official docs or source in `deepseek-ai/deepseek-harness`
- `[论文·窗口内]` arXiv, submitted within three months
- `[论文·窗口外]` arXiv, older than three months
- `[判断]` engineering judgement with no external source

---

## A1 · Judgement lives in a pack, which is the only place the rules live

**Decided** 2026-11-13. Supersedes an earlier inline-constant design in which the registry
existed twice with nothing comparing them.

**Rests on**
- `[论文·窗口外]` SIGIL (arXiv:2607.27309): rules expressed in a validated intermediate form
  raise adherence from 26.2–54% to up to 100% in their four-model, eleven-skill setup, and cut
  runtime tokens by 21–45% **for three of the four models**. Both conditions matter; quoting the
  range without them overstates it.
- `[论文·窗口内]` Harness Engineering (arXiv:2608.26197): a deterministic execution layer
  **degraded reproducibility** in 2 of 4 model–task cells. The metric is reproducibility, not task
  success, and their later Structured Planning removes the effect. Determinism is not automatically
  an improvement.
- `[判断]` Two copies of one registry with no comparator is a defect regardless of papers.

**Costs** A pack must be kept valid as the engine grows. There is only one implementation in this
repository - the JavaScript gate. A second one lives outside this repository, on the author's machine, and is
reached through `VERDICT_GATE_PY`; without it
`npm run crosscheck` prints "skipped (not passed)" and exits 2, and CI does not run it. So "the
implementations agree" is a local check that has been performed, not a property this repo enforces.

**Reopens if** a second consumer needs judgement without being able to read the pack file.

## A2 · Rules are compositions over a closed vocabulary; unknown atoms are refused

**Decided** 2026-11-13.

**Rests on**
- `[论文·窗口外]` SIGIL: load-time validation is what converts a mistake into a refusal.
- `[论文·窗口外]` More Skills, Worse Agents? (arXiv:2605.24050): a library of 202 skills costs up
  to 21% pass rate. The vocabulary stays closed so packs compose rather than accumulate.
- `[判断]` A pack that could invent atoms would be a programming language, and we would be
  maintaining a compiler nobody asked for.

**Enforced** `validatePack` throws naming the offending key; the machine-local Python gate prints
the same and exits 2. A rule may not reference another rule's outcome - that is a state machine, and
the test `a rule cannot read another rule's outcome` holds the line.

**Costs** A genuinely new kind of check needs a code change and must clear the four bars in
SCOPE.md. That friction is the point.

**Reopens if** packs repeatedly need an atom that cannot be composed from the existing set.

## A3 · A pack replaces, it does not merge

**Decided** 2026-11-13.

**Rests on**
- `[权威]` Cordis schema: "A patch config replaces the whole config."
- `[论文·窗口外]` More Skills: implicit accumulation is the failure mode being avoided. Deep
  merging creates exactly that - a pack whose effective content nobody can read off the file.
- `[判断]` Merge bugs are the expensive kind: the value looks set, and is not.

**Costs** Changing one threshold means copying the pack. Accepted.

**Reopens if** packs become large enough that copying them is error-prone - then a generator,
not a merge algorithm.

## A4 · The pack and the skill stay separate files

**Decided** 2026-11-13.

**Rests on**
- `[论文·窗口内]` SkillCompiler (arXiv:2610.39508): compile what is determinate, keep the
  interpretive parts for the model. The pack is determinate data; the skill is interpretation.
- `[判断]` Different readers. The model would be served schema it cannot use; code would be
  served tutorial prose it must skip.

**Reopens if** one of the two stops being consumed.

## A5 · The plugin reads its words and paths from the pack

**Decided** 2026-11-13. Previously the plugin carried its own copy of both.

**Rests on**
- `[判断]` Single source of truth. No paper; this is simply not storing the same list twice.

**Enforced** `reads its words from the pack, not from a hard-coded copy`: a pack whose words are
`["banana"]` stops the built-in words from firing and makes the new one fire. A missing or
broken pack falls back to built-in defaults with a warning rather than failing to load.

**Costs** The plugin now reads a file at load time.

**Reopens if** loading a pack ever becomes a startup liability.

## A6 · The packaged default carries no domain quantities

**Decided** 2026-11-13, after the first version shipped one project's measurement names as the
default.

**Rests on**
- `[判断]` A general tool that starts with somebody's `div_ratio` is a specialised tool wearing
  a general name. Whoever installs it would inherit conclusions they did not measure.
- `[论文·窗口外]` More Skills, Worse Agents?: inheriting an unreadive library is how a system
  gets worse while appearing more capable.

**Enforced** `packs/generic.json` has empty registries and the full rule set; the filled-in
study lives in `packs/examples/`. A test asserts the default is domain-free and that citing an
unregistered quantity is refused.

**Costs** First run is noisier: every quantity a new project cites must be registered before it
can be used. That is the correct order.

**Reopens if** the mechanism turns out to need a starter vocabulary - then it is a small,
deliberately generic one, not a study's.

## A7 · A pack that declares an evidence floor must compose it

**Decided** 2026-11-13, after the property suite showed an empty verdict passing a pack that
carried no sources rule.

**Rests on**
- `[判断]` `thresholds.minSources` is mandatory and must be a positive integer, so every pack
  already states an evidence floor. A pack that states one and never composes it does not have a
  weaker guarantee - it has none, because the interpreter only runs the rules a pack composes.
- `[论文·窗口外]` SIGIL (arXiv:2607.27309): the value of a validated intermediate form comes from
  refusals at load time, not from warnings at run time.
- `[判断]` A check with `over` loops over a registry, and an empty registry makes it vacuously
  true, so such a check cannot serve as the floor.

**Enforced** `validatePack` throws when no rule composes `sources>=minSources` without `over`;
the Python gate returns the same error. Four tests hold the line: deleting the rule is refused, a
sources check with `over` does not count, a sources rule scoped by `when` does count, and the
"removing a rule only relaxes the verdict" property now also asserts that removing this one
voids the pack instead.

**Costs** A pack cannot check something narrower than "at least minSources distinct sources".
That is deliberate: the tool exists to demand evidence, and this was the one hole where it did
not. It is also a breaking change for any third-party pack - there are none yet.

**Reopens if** a real domain needs a pack whose evidence floor is not a source count. The answer
would be a new atom, not a hole in this one.

---

## Withdrawn

## X1 · Tolerating unknown schema fields

**Withdrawn** 2026-11-13, before implementation. The proposal was to accept packs whose
`schemaVersion` matched on the major number and to ignore unknown fields.

**Why withdrawn** It was written from habit, not evidence, and it runs **against** SIGIL, whose
result comes precisely from strict typed validation. Relaxing a schema to be friendly is how
the refusal that makes a validator useful disappears.

**What would bring it back** A demonstrated case where a pack written for a newer tool must run
on an older one - and even then, the answer may be to upgrade the tool.
