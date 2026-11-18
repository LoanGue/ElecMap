/**
 * ElecMap — electrical circuit analysis engine.
 *
 * @packageDocumentation
 */

declare const __ELECMAP_VERSION__: string | undefined;

/** Current version of the ElecMap package (injected from `package.json` at build time). */
export const VERSION: string =
  typeof __ELECMAP_VERSION__ === "string" ? __ELECMAP_VERSION__ : "0.0.0-dev";

export { ElecMapError } from "./core/errors";
export type { ElecMapErrorCode } from "./core/errors";
export * from "./math";
export * from "./format";
export { compile, CompiledCircuit } from "./core/circuit";
export type { CompileOptions, CircuitInput } from "./core/circuit";
export * from "./mna";
export * from "./analysis";
export * from "./render";
export * from "./symbolic";
export { ElecMap } from "./ElecMap";
export type { AnalysisPoint } from "./ElecMap";
