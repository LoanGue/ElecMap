/**
 * ElecMap — electrical circuit analysis engine.
 *
 * @packageDocumentation
 */

/** Current version of the ElecMap package. */
export const VERSION = "0.0.0";

export { ElecMapError } from "./core/errors";
export type { ElecMapErrorCode } from "./core/errors";
export * from "./math";
export * from "./format";
export { compile, CompiledCircuit } from "./core/circuit";
export type { CompileOptions, CircuitInput } from "./core/circuit";
