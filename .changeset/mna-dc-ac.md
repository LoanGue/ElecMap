---
"elecmap": minor
---

Add the `ElecMap` class with DC operating point and AC (phasor) analyses: `voltage(a, b?, at?)`, `current(id, at?)`, `acSweep`, `power`, `setValue`. Built on a Modified Nodal Analysis system (`MnaSystem`) with models for every linear component: R, C, L, coupled inductors, independent and controlled sources, op-amps (ideal / finite gain / GBW) and switches.
