/**
 * Machine-readable error codes raised by ElecMap.
 *
 * Codes are stable across minor versions so that host applications can
 * branch on them (e.g. to highlight a faulty component in a UI).
 */
export type ElecMapErrorCode =
  /** A linear system has no unique solution (floating node, voltage-source loop…). */
  | "SINGULAR_MATRIX"
  /** Matrix / vector dimensions do not match. */
  | "DIMENSION_MISMATCH"
  /** An argument is outside of its valid domain. */
  | "INVALID_ARGUMENT"
  /** Division by a zero polynomial or by zero. */
  | "DIVISION_BY_ZERO"
  /** An iterative algorithm failed to converge. */
  | "NO_CONVERGENCE"
  /** The netlist or JSON input could not be parsed. */
  | "PARSE_ERROR"
  /** The circuit is structurally invalid (see `details.issues`). */
  | "INVALID_CIRCUIT"
  /** An equivalent R, L or C was requested for a network that is not purely of that kind. */
  | "NOT_HOMOGENEOUS"
  /** A referenced component or node does not exist. */
  | "NOT_FOUND"
  /** The feature is not supported (yet). */
  | "UNSUPPORTED";

/** Error thrown by every ElecMap API. Inspect {@link ElecMapError.code} to react programmatically. */
export class ElecMapError extends Error {
  /** Stable machine-readable error code. */
  readonly code: ElecMapErrorCode;
  /** Optional structured context (component id, node name, matrix size…). */
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: ElecMapErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ElecMapError";
    this.code = code;
    this.details = details;
  }
}
