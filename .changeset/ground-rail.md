---
"elecmap": minor
---

Schematics can close the circuit with a ground rail: `toSVG({ ground })` and `layout({ ground })` accept `"rail"`, `"symbols"` or `"auto"` (default: the rail when every grounded pin reaches it by a straight, unobstructed drop, one ground symbol per grounded pin otherwise).
