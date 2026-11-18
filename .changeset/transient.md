---
"elecmap": minor
---

Add time-domain analysis: `ElecMap.transient()` (Gear-2, trapezoidal or backward Euler, DC or `IC=` start, SPICE waveforms or custom input signals) returning voltages, currents and power over time; `TransferFunction.stepResponse()`, `impulseResponse()`, `response(input)` (exact discretisation by matrix exponential) and `stepInfo()` (overshoot, rise and settling times). Step waveforms now hold `v1` at `t = delay`. New math helper `expm`.
