# A client-side UI

**Rejected for now:** shipping the `dsh.client` half (React 19 + StyleX via astryx).

**Why.** DSH's client half runs in the browser as `__ModuleLoader__` + plain JS with no React
runtime, so a UI means adding React, a styling layer and a build step to a package that
currently has none. astryx itself is still Beta. And the decisive question has no answer
yet: **what does DOT need to *show* that cannot be done without showing it?** Its value is
that it stays out of the way.

**What we do instead.** Everything is observable from files: `auditPath` writes one JSONL
line per hit, the gate exits 0/1/2, and `npm run verify` is one command.

**What would reopen this.** A question that only a human looking at a screen can answer -
for example "how many hits this week, and how many were false positives" once the audit log
has data worth reading. Even then: a read-only card first, no router, no state library.
