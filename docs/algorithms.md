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

## Transfer functions

`H(s) = y(s) / u` (output linear form `y`, single input source `u`) is obtained as `N(s) / D(s)` with `D(s) = det(G + s·C)` and `N(s) = y(s)·D(s)` (Cramer's rule).

Expanding a polynomial determinant directly loses accuracy in floating point when component values span many decades (1 Ω with 1 mF next to 1 MΩ with 1 pF). ElecMap instead:

1. picks a **frequency scale** `σ` (geometric mean of the static/dynamic entry ratios, refined from the poles of a first pass);
2. **samples** `D` and `N` at `m = n + 1` points `s = σ·e^{iθₖ}` on a circle, each sample being one complex LU factorisation (determinant + solve);
3. recovers the coefficients with a **discrete Fourier transform**, which is perfectly conditioned on the unit circle, then rescales `p = s/σ`;
4. **cancels** pole/zero pairs that coincide (modes that the input cannot excite or the output cannot see), so `order` is the true order;
5. normalises the denominator to `1 + a₁s + …`.

Poles and zeros come from the Aberth–Ehrlich solver. Cutoff frequencies are found by bisection in log-frequency on `|H| = ref/√2`, the peak by golden-section search.

## Equivalent impedances

`Z(s)` between `a` and `b` reuses the transfer-function machinery: the independent sources are zeroed (voltage sources become shorts, current sources opens, exactly what their MNA stamps do with a zero value), a 1 A test current is injected into `a` and drawn from `b`, and `V(a) − V(b)` is the output.

- **R / L / C equivalents** check the shape of `Z(s)`: constant (R), `1/(C·s)` (C), `L·s` (L); otherwise `NOT_HOMOGENEOUS` is thrown, unless `mode: "dc"` (Z(0)) or `mode: "freq"` (value of the equivalent component at one frequency) is requested.
- **Thévenin:** `Vth` is the open-circuit voltage (DC operating point or AC phasor), `Zth = Z(a, b)`; Norton follows as `In = Vth / Zth`. Maximum power transfer uses `R = Rth` (DC) or the conjugate match `Z = Zth*` (AC, `P = |Vth|² / 8·Re Zth` for peak phasors).
- **Input impedance** of a voltage source is `−V / I(V)` (SPICE current convention), of a current source the impedance between its terminals.
