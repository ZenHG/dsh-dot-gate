# Average-accuracy acceptance

**Rejected:** accepting a skill, rule or asset because its average success rate
went up.

**Why.** Decomposing nearly 6000 runs shows that the strongest skills mostly win
by *breaking fewer previously-solvable cases*, not by solving more. Averaged over
a suite, that trade is invisible; the average goes up while the failures move
somewhere the average does not look. See *The Regression Tax* (arXiv:2607.22520)
and *Not All Skills Help* (arXiv:2606.15390).

**What we do instead.** A small frozen regression set that must always pass.
Passing it is a floor, not a score. A change that raises the average but breaks
one frozen sample is rejected.

**What would reopen this.** A benchmark where the average and the regression set
are shown to agree across model families, and where the regression set is
demonstrably not just a subset of the benchmark.
