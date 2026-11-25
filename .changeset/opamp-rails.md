---
"elecmap": minor
---

Add op-amp output rails: `Xname in+ in- out OPAMP [GAIN=a] [GBW=f] [VSAT=v | VPOS=v VNEG=v]`, `OpAmpJSON.vpos` / `vneg`. In DC and transient analyses the output saturates smoothly between the rails (solved by Newton-Raphson), so comparators and Schmitt triggers switch with hysteresis; AC analyses and transfer functions are linearised at the operating point (gain about 0 when saturated). Op-amps without rails are unchanged.
