# Vendor state machines (xstate, langgraph)

**Rejected:** pulling in a workflow/state-machine library to express the gate.

**Why.** The gate is six rules with no branching that survives a turn boundary. Measured
cost of the alternatives: `langgraphjs` needs the existing loop restructured into a node
graph; `xstate` is lighter but still adds a dependency and a second mental model for six
`if`s. The bundle stays at zero runtime dependencies today, which is why it installs and
runs anywhere without a build step.

**What we do instead.** Plain functions in `src/verdict.mjs`, ordered so each rule reads
as one guard. Revisit when the rules exceed roughly ten and start sharing state.

**What would reopen this.** A rule set where transitions depend on earlier transitions
(the thing a statechart actually buys), or a second surface that must run the same rules
with different ordering.
