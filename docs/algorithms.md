# Algorithms

This document describes the numerical methods used by ElecMap.

## Math core (`src/math`)

| Building block        | Method                                                                        | Notes                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Complex`             | Immutable `re + j·im`                                                         | Division uses Smith's algorithm to avoid overflow.                                                                                                                      |
| `Polynomial`          | Real coefficients in ascending powers of `s`                                  | Additions flush catastrophic-cancellation residue (`                                                                                                                    | a+b | ≤ 1e-13·( | a   | +   | b   | )`) to exactly 0, so that symbolic-like identities hold, while legitimately tiny coefficients (e.g. `LC = 1e-12`) are preserved. |
| `Rational`            | `N(s) / D(s)`                                                                 | Transfer functions and impedances. Normalisable to the engineering form `… / (1 + a·s + …)`.                                                                            |
| `RealLU`, `ComplexLU` | Dense LU with partial pivoting                                                | Factor once, solve many right-hand sides (transient analysis). Singularity is detected relative to the largest matrix entry.                                            |
| `bareissDeterminant`  | Fraction-free Bareiss elimination over a generic `Ring<T>`                    | With the polynomial ring it yields `det(A(s))` exactly; transfer functions follow from Cramer's rule on the MNA matrix. The same code will run on symbolic polynomials. |
| `polynomialRoots`     | Closed forms up to degree 2, Aberth–Ehrlich iteration above, Newton polishing | Used for poles and zeros. Real roots are returned with an exactly zero imaginary part.                                                                                  |

## Modified Nodal Analysis

Every analysis works on the system `(G + s·C)·x = b`, assembled once per circuit by `MnaSystem`:

- **Unknowns:** non-ground node voltages (in `circuit.nodes` order), then one branch current per voltage source, inductor, VCVS, CCVS, op-amp output and ideal closed switch.
- **G** holds conductances and topological ±1 entries, **C** holds the coefficients of `s` (capacitances, −L on inductor branches, −M for couplings, the GBW pole of op-amps).
- **b** is built from the independent sources for the analysis at hand (DC values, AC phasors, or a single unit source for transfer functions).

| Component            | Stamp                                                                          |
| -------------------- | ------------------------------------------------------------------------------ |
| Resistor / capacitor | admittance `1/R` in G, `C` in C between its two nodes                          |
| Inductor             | branch: `Va − Vb − s·L·I = 0`                                                  |
| Coupling             | `−s·M` between the two inductor branches, `M = k·√(L1·L2)`                     |
| Voltage source       | branch: `Vp − Vn = E`                                                          |
| Current source       | `b[p] −= I`, `b[n] += I`                                                       |
| VCVS (E) / CCVS (H)  | branch: `Vp − Vn − A·Vc = 0` / `Vp − Vn − r·Ictrl = 0`                         |
| VCCS (G) / CCCS (F)  | transconductance / current gain entries in the KCL rows                        |
| Op-amp               | output branch; ideal: `V+ − V− = 0`; finite: `Vout·(1 + s·A/ωt) = A·(V+ − V−)` |

The same matrices are evaluated at `s = 0` (DC, real LU), `s = jω` (AC, complex LU) or kept as a polynomial matrix in `s` (transfer functions). Any quantity (voltage between two nodes, current through a component) is a _linear form_ `Σ (g + s·c)·x` evaluated on the solution.

When the DC system is singular because a node has no DC path (behind series capacitors), a `gmin = 1e-12 S` conductance to ground is added, as in SPICE; `DcSolution.gminUsed` reports it.
