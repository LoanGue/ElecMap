# Algorithms

This document describes the numerical methods used by ElecMap.

## Math core (`src/math`)

| Building block        | Method                                                                        | Notes                                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Complex`             | Immutable `re + j·im`                                                         | Division uses Smith's algorithm to avoid overflow.                                                                                                                                                                      |
| `Polynomial`          | Real coefficients in ascending powers of `s`                                  | Additions flush catastrophic-cancellation residue (`abs(a + b) ≤ 1e-13·(abs(a) + abs(b))`) to exactly 0, so that symbolic-like identities hold, while legitimately tiny coefficients (e.g. `LC = 1e-12`) are preserved. |
| `Rational`            | `N(s) / D(s)`                                                                 | Transfer functions and impedances. Normalisable to the engineering form `… / (1 + a·s + …)`.                                                                                                                            |
| `RealLU`, `ComplexLU` | Dense LU with partial pivoting                                                | Factor once, solve many right-hand sides (transient analysis). Singularity is detected relative to the largest matrix entry.                                                                                            |
| `bareissDeterminant`  | Fraction-free Bareiss elimination over a generic `Ring<T>`                    | With the polynomial ring it yields `det(A(s))` exactly; transfer functions follow from Cramer's rule on the MNA matrix. The same code will run on symbolic polynomials.                                                 |
| `polynomialRoots`     | Closed forms up to degree 2, Aberth–Ehrlich iteration above, Newton polishing | Used for poles and zeros. Real roots are returned with an exactly zero imaginary part.                                                                                                                                  |

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

## Non-linear circuits

A non-linear device adds a `load` step to its MNA stamp. A diode has its own branch current `I` as an unknown: its KCL incidence sits in G (and `CJO` in C), and its branch row is filled at each Newton iteration with the tangent of the Shockley law at the current iterate `V_j⁰`:

<div class="em-math">(1 + g\,R_S)\,I - g\,V_A + g\,V_K = I_d(V_j^0) - g\,V_j^0, \qquad g = \frac{\partial I_d}{\partial V_j}(V_j^0)</div>

The device equation is algebraic (it is not scaled by the integration method), and the current is a linear form like any other.

Transistors follow the same pattern with more unknowns: a BJT has two branch currents (collector `I(Q1)` and base `I(Q1:b)`, the emitter current being `−I_C − I_B`), a MOSFET one (the drain current). Each branch row is the tangent plane of its current in the controlling voltages, `I_C = I_C⁰ + g_{be}(V_{BE} − V_{BE}⁰) + g_{bc}(V_{BC} − V_{BC}⁰)` for a BJT and `I_D = I_D⁰ + g_m ΔV_{GS} + g_{ds} ΔV_{DS} + g_{mbs} ΔV_{BS}` for a MOSFET; a PNP / PMOS is solved as an NPN / NMOS with every voltage and current negated.

- **Newton-Raphson.** Each iteration rebuilds `G + J` and solves it by LU. An iterate is accepted when every voltage moves by less than `reltol·|v| + vntol` and every current by less than `reltol·|i| + abstol`, after at least two iterations and with no device limited; one last step is then taken from the accepted point, which, Newton being quadratic, makes the result accurate far below the tolerances.
- **Limiting.** As in SPICE (`pnjlim`), a junction voltage step above the critical voltage `V_crit = N·V_T·ln(N·V_T / (√2·I_S))` is replaced by a logarithmic one; the breakdown branch is limited the same way. On the first iteration every junction starts at `V_crit`. BJTs limit both junctions this way; MOSFETs limit `V_GS` and `V_DS` with SPICE's `fetlim` / `limvds`, starting at `V_GS = VTO`. `gmin = 1e-12 S` sits across each junction, and exponentials are continued linearly beyond `e^80` to avoid overflow.
- **DC homotopies.** If plain Newton fails: **gmin stepping** (a conductance from every node to ground, from 10 mS down to 0, each solve starting from the previous one), then **source stepping** (all independent sources scaled from 0 to 1 with an adaptive step). Otherwise `NO_CONVERGENCE` is thrown.
- **Transient.** Each time step is a Newton solve on the companion system `(α·C + G)`, starting from the previous point; device states (last junction voltages) are carried from step to step.
- **Small signal.** `system.smallSignal(x)` builds a new linear `MnaSystem` whose G includes the Jacobian at `x` (the operating point). Every frequency-domain analysis runs on it unchanged. The literal (symbolic) engine refuses non-linear circuits.

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

## Time domain

**Transient analysis** integrates `C·x' + G·x = b(t)` with a fixed step `h`. The first step is backward Euler, the following ones use the chosen method:

| method            | update                                             | notes                                                   |
| ----------------- | -------------------------------------------------- | ------------------------------------------------------- |
| `gear2` (default) | `(3/2h·C + G)·xₙ₊₁ = bₙ₊₁ + C·(4xₙ − xₙ₋₁)/2h`     | 2nd order, L-stable: no ringing after discontinuities   |
| `trap`            | `(C/h + G/2)·xₙ₊₁ = (bₙ₊₁ + bₙ − G·xₙ)/2 + C·xₙ/h` | 2nd order, conserves the energy of lossless LC circuits |
| `euler`           | `(C/h + G)·xₙ₊₁ = bₙ₊₁ + C·xₙ/h`                   | 1st order, strongly damped                              |

The step matrix is factorised once. The initial state is the DC operating point with the sources at `t = 0`, or, with initial conditions, the charges `C·x(0)` built from the `IC=` values; consistent algebraic unknowns are then obtained with a vanishing backward-Euler step. Currents of capacitors and inductors' voltages use the derivative `x'`, estimated by second-order backward differences.

**Responses of a transfer function** (`stepResponse`, `impulseResponse`, `response`) are exact: `H(s)` is turned into a controllable canonical state-space model (time-scaled by `σ`, the geometric mean of the poles' magnitudes, for conditioning), discretised with the matrix exponential of the augmented matrix `[[A, B], [0, 0]]·h` (scaling and squaring, Padé 13 — Higham 2005). Inputs are held constant over a step, so steps and piecewise-constant inputs are exact, and smooth inputs have an `O(h)` error.

## Symbolic transfer functions

`src/symbolic` rebuilds the MNA matrix with entries that are sparse multivariate polynomials (`MPoly`) in `s` and in one variable per literal component. Resistors enter through a hidden conductance `G = 1/R`, so that every stamp stays polynomial.

- **Determinant.** `det(A)` is computed by Laplace expansion along the rows (sparsest first), memoised on the set of columns already used. It is exact, needs no division (unlike Bareiss, which would require exact multivariate division) and is fast on the very sparse MNA matrices. A guard rejects circuits whose expansion would explode (keep fewer symbols with the `symbols` option).
- **Numerator.** With `A·x = b·u` and an output `y = f·x`, the bordered determinant gives `det([[A, b], [f, 0]]) = −det(A)·f·A⁻¹·b`, so `N = −det([[A, b], [f, 0]])` and `H = N / det(A)` without solving anything.
- **Conductances.** Each `G` appears with a bounded power `e` (1 for a resistor); `N` and `D` are both multiplied by `R^e` and `G^k` is replaced by `R^{e−k}`.
- **Simplification.** Common monomials and integer factors are removed and the sign of `D` is fixed; a purely numeric constant term of `D` is scaled to 1. LaTeX groups the terms by power of `s` and factors out the common monomial of each group: `C_{2} \left(R_{1} + R_{2}\right) s`.

The test suite checks every expression against the numeric engine by substituting the component values.

## Schematic layout

`src/render` draws a circuit without any external dependency, in three stages.

**1. Placement (`layout.ts`).** Nodes (ground excluded) get a column and a row on a coarse grid:

- a breadth-first search from the hot node of the first grounded source orients every two-terminal branch from left to right; op-amp inputs always point towards their output. Cycles are broken by a Kahn topological sort;
- a node's column is one more than the furthest of its predecessors (the nearest for ordinary branches, so that parallel paths stay compact); disconnected sub-circuits are placed side by side;
- rows are ordered by the barycentre of the predecessors' rows (inverting op-amp inputs on top), and an op-amp output is aligned with its inputs so that the input wire stays straight;
- each column is widened by the number of shunt elements it carries.

Components are then placed in priority order, each taking the first candidate position whose footprint (body, texts and pins) is free: op-amps, shunt elements (vertical, with their own ground symbol, sources first), series elements between adjacent columns (horizontal), branches inside one column (vertical) and long or feedback branches (above the circuit).

**2. Routing (`router.ts`).** Wires are routed on the unit grid by an A* search over (vertex, incoming direction) states, so that bends can be costed (step 1, bend 4, crossing 8, near a text 6). Component bodies are hard obstacles. Between different nets the router forbids shared segments and any contact at a pin, bend or junction; only straight perpendicular crossings are allowed. Each net is grown as a rectilinear Steiner tree: starting from its anchor point (or a pin), the nearest unconnected pin is routed to the existing tree. Nets are routed shortest first. If no legal path exists, the search is repeated with every forbidden move replaced by a large penalty, so routing never fails. Dangling stubs are pruned and unit edges merged into maximal segments; a junction dot is drawn where three or more wire ends meet.

**Ground.** With `ground: "rail"` the ground becomes a net like the others, routed first: a horizontal rail one cell below everything placed, from the leftmost to the rightmost grounded pin, then one drop per grounded pin (straight when the column is free, A* otherwise), with a single ground symbol under the rail. `"auto"` builds the rail only when there are at least two grounded pins and every drop is straight and touches no body, pin, text or other wire; otherwise it falls back to one symbol per grounded pin. The cells under each grounded pin are reserved during placement in both modes, so the placement does not depend on the choice.

**3. Rendering (`svg.ts`).** Symbols are drawn in a local frame and rotated into place; IEC and ANSI variants are available. Colours are CSS variables with a `prefers-color-scheme` dark variant, and every element carries `data-*` attributes for interactivity.

The test suite checks, for reference circuits and for random netlists, that every net is connected, that no two nets share a segment or touch, and that no wire crosses a component body.
