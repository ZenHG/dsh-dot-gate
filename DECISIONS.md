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

## A1 · Judgement lives in a pack, and both implementations read the same one

**Decided** 2026-11-13. Supersedes an earlier inline-constant design in which the registry
existed twice with nothing comparing them.

**Rests on**
- `[论文·窗口外]` SIGIL (arXiv:2607.27309): rules expressed in a validated intermediate form
  raise adherence from 26.2–54% to up to 100%, with 21–45% fewer tokens.
- `[论文·窗口内]` Harness Engineering (arXiv:2608.26197): a deterministic execution layer made
  2 of 4 model–task combinations **worse**. Determinism is not automatically an improvement.
- `[判断]` Two copies of one registry with no comparator is a defect regardless of papers.

**Costs** A pack must be kept valid as the engine grows; `npm run crosscheck` must pass with
the pack hash printed, or "the implementations agree" means nothing.

**Reopens if** a second consumer needs judgement without being able to read the pack file.

## A2 · Rules are compositions over a closed vocabulary; unknown atoms are refused

**Decided** 2026-11-13.

**Rests on**
- `[论文·窗口外]` SIGIL: load-time validation is what converts a mistake into a refusal.
- `[论文·窗口外]` More Skills, Worse Agents? (arXiv:2605.24050): a library of 202 skills costs up
  to 21% pass rate. The vocabulary stays closed so packs compose rather than accumulate.
- `[判断]` A pack that could invent atoms would be a programming language, and we would be
  maintaining a compiler nobody asked for.

**Enforced** `validatePack` throws naming the offending key; the Python gate prints the same
and exits 2. A rule may not reference another rule's outcome - that is a state machine, and
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
