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
