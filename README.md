# dsh-dot-gate

Make an agent check its own verdict gate **before** it writes a negative
capability conclusion into a knowledge base.

## The problem

An agent that keeps notes will eventually write something like *"this model
cannot do X"* into a wiki. That sentence outlives the evidence it was based on.
The usual reminder plugins fire on a **tool-call counter** - they nudge when the
agent is busy. But the failure is not busyness, it is speed of judgement: one
source is read, a capability is declared impossible, and the claim is committed.

A counter-based nudge does not correlate with that failure. The action does.

## What it does

It watches `tool/call` / `tool/ptc-dispatch-start` for `write` and `edit`
calls whose target path is under a watched prefix and whose body contains a
configured phrase. On the next step it injects **one** reminder asking the agent
to run the project's own gate and to state sources, counter-examples, the metric
used, whether the contrasted variable is known to be effective, and a
re-runnable command.

It does not judge the claim and it never blocks. Whether three sources are enough
is a policy question; this plugin only refuses to let the claim pass silently.

## Two modes

| mode | what happens | why |
|---|---|---|
| `hardMode: false` (default) | the write lands, then one reminder is injected | the file is already on disk, so the reminder asks for a correction |
| `hardMode: true` | the write is **refused** by a `tools/pre-execute` guard, with a model-facing reason | the only place a write can actually be stopped |

The guard is opt-in on purpose. A gate that blocks a write on its first day gets
uninstalled; the reminder mode is how you measure the false-positive rate first.

## Install

```
dsh plugin --profile <name> add dsh-dot-gate
```

Then add `dsh-dot-gate` to `dsh.profile.bundles` in the profile's
`package.json` and restart the host. Editing `cordis.patch.yml` config hot
reloads; Node code does not.

## Config

```yaml
- insert:
    - id: dot-gate
      name: dsh-dot-gate
      config:
        maxPerTurn: 1
        paths: [Wiki/]
        tools: [write, edit]
        words: [做不到, cannot be done]
```

| key | default | meaning |
|---|---|---|
| `maxPerTurn` | `1` | reminders per turn; `0` disables injection |
| `steerAtTurnEnd` | `false` | if a hit was never addressed, object once at the close boundary; the turn then runs another step |
| `auditPath` | `''` | JSONL path for one line per hit; empty means the plugin writes no file at all |
| `paths` | `["Wiki/"]` | a write is inspected only if its path contains one of these |
| `tools` | `["write","edit"]` | tool names to inspect |
| `words` | see above | any match marks the write as a capability claim |

## Judgement pack

What counts as enough evidence lives in one JSON file, read by both implementations. It
carries data only: the words that mark a claim, the watched paths, the thresholds, the
registered quantities and their liveness.

Two packs ship:

| pack | what it is |
|---|---|
| `packs/generic.json` | **the default**. Same rules, **empty registries** - the mechanism without anyone's quantities |
| `packs/examples/h3-camera-study.json` | a filled-in example: evidence standards for camera-movement claims in a video-model study |

That split is the point. A general tool must not ship with one project's measurement names
baked in; a project either fills in `metrics`/`liveVars` or points `packPath` at its own file.
Until a quantity is registered, citing it is refused - which is the intended first-run
experience, not a bug.

`rules` **composes** atoms from a closed vocabulary; it never invents one. A pack that names
an unknown atom is refused at load, with the key. A rule that referenced another rule's
outcome would be a state machine, so that is refused too.

## The skill it ships

The package also contributes a skill named `dot`, through the official skill
registry rather than through a profile path:

```js
export const inject = ['skills']
ctx.skills.registerProvider(() => ({ name: 'dot-gate', async list() { ... }, async get() { ... } }))
```

The skill body lives in `skills/dot/SKILL.md` and is read from disk when the
registry lists it, so editing that file needs no rebuild. It describes the loop the
plugin only nudges towards: collect sources, name a registered quantity, check that a
contrasted variable is actually live, write down a re-run, then gate the conclusion.

Why a provider and not a directory setting: `customSkillDirs` configures *one*
existing provider. A plugin that wants to contribute skills should register its own,
which is the seam the bundled skills use.

## Privacy

The plugin reads tool arguments in memory to match a phrase. It writes no file,
opens no socket, logs nothing, and keeps no state across restarts. Nothing
leaves the process.

## Limits

- It sees the call, so the file may already be on disk when the reminder lands.
  The reminder asks for a check, not a revert.
- Phrase matching is deliberately dumb. It will miss paraphrases and it will fire
  on quotations of other people's claims.
- It has no opinion about your gate. Point `words` at whatever your project
  treats as a conclusion.

## Process

One page from "is this worth doing" to "released": [PROCESS.md](./PROCESS.md).

## License

MIT
