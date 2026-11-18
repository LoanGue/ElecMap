---
"elecmap": minor
---

Add literal (symbolic) analysis: `ElecMap.symbolicTransferFunction()` and `ElecMap.symbolicImpedance()` return a `SymbolicTransferFunction` whose coefficients are polynomials in the component names, rendered as LaTeX (`rac{1}{1 + R_{1} C_{1} s}`) or text, with `substitute(values)` back to a numeric `TransferFunction`. Selected components can stay numeric (`symbols`), and symbol names can be customised (`names`). New exports: `MPoly`, `SymbolicSystem`, `symbolicDeterminant`.
