---
"elecmap": minor
---

Add schematic rendering: `ElecMap.toSVG(options)` produces a standalone SVG (IEC or ANSI symbols, values, node labels, highlighting, light/dark themes, `data-*` hooks) from a home-made layout engine (column/row placement and an A* orthogonal wire router), and `ElecMap.layout()` exposes the placement itself.
