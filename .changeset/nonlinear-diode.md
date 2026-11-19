---
"elecmap": minor
---

Diodes and Zener diodes (`D` lines, `type: "diode"`) with SPICE `.model D(...)` cards, area factors and inline parameters. Non-linear circuits are solved by Newton-Raphson with SPICE junction limiting, gmin stepping and source stepping, in DC and in transient. Small-signal analyses (AC, transfer functions, impedances, Thévenin) use the circuit linearised at the operating point (`ElecMap.smallSignal`). New "Diodes" guide in English and French.
