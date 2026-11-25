---
"elecmap": minor
---

`transferFunction({ input: { voltage } })` no longer needs `source` when several sources drive the circuit: the ratio is used when every source reaching the input gives the same one (sources in series), otherwise the error names the sources.
