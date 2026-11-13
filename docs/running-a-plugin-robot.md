# Running a plugin robot in production: what actually broke

English | [中文](running-a-plugin-robot.zh.md)

This is not a design document. It is the failure log from building *this* plugin's companion
robot: the one that watches for a write under a knowledge base, runs the project's own closeout
chores, and reports one line back. Everything below was observed on Windows with DSH 0.2.2, and
every claim carries the command or the error text that produced it.

Read it before writing another plugin that runs background work, and read
[DECISIONS.md](../DECISIONS.md) next to it: this file records what broke, that file records what
was decided.

## 1. A plugin can be loaded, registered, and still do nothing

The first version looked installed from every angle and produced no effect. Three different
questions hide behind the word "installed":

| Layer | Question | How to answer it |
| --- | --- | --- |
| disk | is the package there, and is it a link or a copy? | `Get-Item <profile>\node_modules\<pkg> -Force | Select-Object LinkType, Target` |
| profile | did the profile select it? | `(Get-Content <profile>\package.json -Raw | ConvertFrom-Json).dsh.profile.bundles` |
| runtime | did the running host actually register it? | a trace file the plugin writes, or evidence inside the session |

The third layer is the only one that answers "can this session use it", and it is the one nobody
checks. `appliedAt` and `sourceHash` are not evidence: under a `link:` install they update while the
running process keeps the old module.

## 2. Reading an undeclared property of `ctx` throws at load

This cost four restarts and was invisible, because the plugin had already written its load stamp
before the throw. The exact failure:

```
phase=register-error
message: cannot get property "spawn" without inject
stack:   at new apply (.../index.js:163:78)
         at Fiber.execute (.../@deepseek-ai/cordis/lib/index.js:362:24)
```

`ctx` is a proxy. Reading `ctx.<anything>` that the plugin did not declare in `inject` throws -
it does not evaluate to `undefined`. A plugin that does `const spawn = ctx.spawn ?? null` therefore
fails at load, after whatever it logged before that line.

Two consequences worth keeping:

- **Do not probe `ctx` for optional seams.** Use the module you control (`node:child_process` for
  spawning) and let a test inject a fake through config instead.
- **Record load phases, not a single "loaded" line.** Write `enter` before registration and `ready`
  after the last `ctx.on(...)`. The gap between them localises the failure to one step. A guard
  that only wraps the first call is worse than none: it looks like protection and is not.

A regression test that would have caught it, and now does:

```js
const guarded = new Proxy({}, {
  get(_t, prop) {
    if (prop === 'on') return (ev, fn) => handlers.set(ev, fn)
    if (prop === 'logger') return { warn() {} }
    throw new Error('cannot get property "' + String(prop) + '" without inject')
  },
})
assert.doesNotThrow(() => apply(guarded, config))
```

## 3. What a restart actually changes, and what it does not

- `dsh plugin --profile <name> add <spec>` forwards to pnpm **and**, on the version we tested,
  appends the package to `dsh.profile.bundles` by itself. Earlier notes saying it only touches
  dependencies were true of an older build.
- A `link:` package does not re-evaluate inside the running host. Editing its source changes the
  disk, not the process. A restart is the only reliable way to load new code.
- Config changes need the same restart when they feed a plugin's `apply(ctx, config)`, because that
  function runs once.

If a change needs a restart, schedule the restart **and** a follow-up check at the same time. A
delayed restart with a watchdog is good; a delayed restart with nobody to read the result is how a
broken build sits for hours.

## 4. Background work has to be able to say it ran

Four things made the difference between "a script that sometimes runs" and "a robot you can trust":

**Record every phase.** `enter`, `ready`, `register-error`, and one `run` line per execution with
the exit codes. "Nothing happened" then splits into four distinguishable states instead of one
silent one.

**Expose a status command with the failure as its own state.** Ours returns
`ok | plugin-not-loaded | register-error | not-ready | no-runs-observed | stale-runs`, and exits
non-zero when it is not `ok`. `plugin-not-loaded` being a distinct status is the whole point: it is
the one failure a plugin cannot report about itself.

**Keep the report short.** A step that succeeds silently is worth having. Ours runs three commands;
the third reports only when it fails, because a report that grows by one item per feature stops
being read. That means the flag has to travel with the result, not just the config - our first
version dropped it when assembling results, and the unit test passed because it called the
summariser directly with the field present.

**Cap the noise.** A pure quiet-period debounce starves: a long editing run never goes quiet, so the
chores never run. Pair it with a hard cap measured from the first queued item. Also cap the number
of runs per turn, or one runaway loop spawns the chores forever.

## 5. One writer at a time - the rule this repository already has

Two host instances were running on the same machine, and a second index build collided with the
first:

```
PermissionError: [WinError 32] The process cannot access the file because it is being used by
another process: '<index>.sqlite'
```

The chores delete and recreate that file, so they are not safe under concurrency. The rule from DS-Bot's
`ds-bot/src/host/home-lock.js` is the one we copied, and it is worth repeating because the subtle
half is easy to miss:

> a live holder needs **both** a pid that still runs **and** a heartbeat fresher than the staleness
> window - a crashed holder's pid may be reused by an unrelated process, and without the heartbeat
> check that unrelated process holds the lock for as long as it runs.

Our implementation is a lock file with `{pid, at}`, refreshed per run, plus the same two-condition
liveness test. The tests that hold it:

- a live holder (a genuinely separate spawned process) makes the run **skip** and say so;
- a dead holder is taken over;
- a live pid with a stale heartbeat is treated as dead.

## 6. Health checks that lie

Two ways a restart script reported success while the application was unusable:

**It accepted any response below 500.** The host listens on more than one port: one answers the
application (401 until authenticated, or 200) and another answers 404 on `/`. A probe written as
"anything below 500 means healthy" therefore latched onto the side service and printed the wrong URL
on every restart. Ranking by what the response is - 401 best, then 2xx/3xx, then 404, and treating
404-only as not serving - fixed it, verified by a dry run that finally printed the UI port.

**It compared UTC with local time.** The plugin's trace stores ISO timestamps with `Z`; the process
start time is local. Comparing them directly reported a healthy plugin as dead on the first run.
That is the worst possible bug in a watcher: one false alarm is often enough to get it muted.

## 7. Watch it from outside, or you are the watcher

A plugin can only report while it is loaded. If it fails to load, or stops running, the only symptom
is silence, and silence is indistinguishable from "nothing happened today".

The fix is a check that does not depend on the plugin: a scheduled task that compares facts which
should agree -

- is a host running, and when did it start;
- does the plugin's trace carry a `ready` newer than that start;
- has the watched directory changed while the robot has not run.

It writes an alert file and raises a notification, with a cooldown, because an alarm that repeats
every ten minutes gets muted and then it is worse than no alarm.

## 8. What we would do differently

- Write the `doctor` command before the feature. It took ten minutes once the states were known,
  and it would have saved every one of the restarts.
- Never write a plugin that can fail silently without a trace. A log file the plugin owns is the
  difference between a diagnosis and a guess.
- Treat "loaded" as a claim that needs a command, not a state to assume.