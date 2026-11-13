# Glossary

Vocabulary drifts first, then the measurements do. These words mean one thing here.

| Term | Meaning |
|---|---|
| **capability claim** | A sentence asserting that a model, method or tool *cannot* do something. The only kind of sentence this plugin reacts to. |
| **observation** | A reading from a single run. It carries no claim about ability, and it must not be phrased as one. |
| **dead channel** | A phrasing or parameter that produces no behavioural difference in the target model. Contrasts anchored on a dead channel are not contrasts. |
| **live variable** | A variable proven to change model behaviour, and therefore usable as the difference between two arms. |
| **false contrast** | Two arms that differ only on a dead channel, reported as if the difference had been tested. |
| **metric registry** | The closed list of named quantities a conclusion may cite. Citing an unregistered quantity is how a wrong measurement becomes a wrong conclusion. |
| **regression set** | Frozen samples that must always pass. They guard against getting worse; they do not chase getting better. |
| **warn / block** | Two modes of an enforcement hook. Warn prints and continues. Block refuses. Default is warn. |
| **trigger** | The event that causes a reminder. This plugin triggers on an action, not on a counter. |
