---
"elecmap": patch
---

Behavioural sources: `B1 out 0 V=V(in)^2/2` or `I=…`, any expression of node voltages, component currents and `time`, with comparisons, logic and SPICE functions (`tanh`, `limit`, `if`, `u`…). DC and transients by Newton-Raphson with exact derivatives, small-signal linearisation, parameters and subcircuits. New "Behavioural sources" guide. A node read by a controlled source is no longer reported as dangling.
