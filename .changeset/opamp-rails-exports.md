---
"elecmap": minor
---

The `.cir` and `.asc` exports keep the op-amp rails: a railed op-amp becomes a subcircuit with a `tanh` behavioural gain stage between the rails, then the GBW pole. The `.asc` keeps that subcircuit instead of LTspice's rail-less `opamp.sub`.
