---
"elecmap": patch
---

Export to other simulators: `toCir()` writes a portable SPICE netlist (LTspice, ngspice, KiCad) with op-amps, switches, `STEP` sources and inline device parameters translated; `toAsc()` writes an LTspice schematic drawn from the layout, with named nets and a connectivity check. Playground: "SPICE" and "LTspice" download buttons using the analysis of the open tab; the ElecMap netlist downloads as `.sp`.
