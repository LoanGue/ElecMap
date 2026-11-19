---
"elecmap": minor
---

Bias-dependent junction capacitances and transit times: diodes take `vj`, `m`, `tt`, `fc` (SPICE `VJ`, `M`, `TT`, `FC`) and BJTs `vje`, `mje`, `vjc`, `mjc`, `tf`, `tr`, `fc`. Small-signal analyses use the capacitance at the operating point and transient analysis integrates the junction charges (reverse recovery, varactors). The capacitive currents are now part of the device branch currents.
