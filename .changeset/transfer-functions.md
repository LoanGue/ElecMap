---
"elecmap": minor
---

Add numeric transfer functions: `ElecMap.transferFunction(output | { input, output })` returns a `TransferFunction` with LaTeX export, frequency response, Bode data, steady-state response to sinusoids (`apply`), poles / zeros, stability, time constants, filter classification, cutoff frequencies, bandwidth, natural frequency and Q. Also adds `latexNumber` / `polynomialToLatex` and `ComplexLU.determinant()`.
