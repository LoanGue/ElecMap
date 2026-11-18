---
"elecmap": minor
---

Add equivalent circuits: `impedance(a, b)` as a rational `Z(s)`, `equivalentImpedance`, `equivalentResistance` / `Capacitance` / `Inductance` (strict, DC or per-frequency), `inputImpedance`, `outputImpedance`, `thevenin` / `norton` in DC and AC with maximum power transfer, and AC complex power per component (`power({ freq })`, `AcSolution.power`). New error code `NOT_HOMOGENEOUS`.
