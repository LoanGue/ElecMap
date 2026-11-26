/**
 * Part naming: the unique SPICE id (`R1`) the netlist uses, and the free
 * display name (`R_load`) shown on the drawing, which may repeat. Pure
 * functions of the drawing.
 */
import { cleanName } from "../model";
import type { Drawing, Part } from "../model";

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";

/**
 * Id written with its trailing digits as subscripts: `C12` gives `C₁₂`. Text
 * that is not letters then digits (`R_load`, `12`, `X1A`) is returned as is.
 */
export function subscript(id: string): string {
  return id.replace(
    /^(\D+)(\d+)$/,
    (_all, head: string, digits: string) =>
      head + [...digits].map((d) => SUBSCRIPT[Number(d)]).join(""),
  );
}

/** Name shown on the drawing: the one the user chose, else the id with a subscript. */
export const displayName = (part: Part): string => part.name ?? subscript(part.id);

/**
 * Drawing where part `id` shows `text`, cleaned by `cleanName`: blank text
 * brings back the default name. The SPICE id never changes, and the same
 * display name may be given to several parts. An unknown id leaves the
 * drawing unchanged.
 */
export function rename(drawing: Drawing, id: string, text: string): Drawing {
  const name = cleanName(text);
  const parts = drawing.parts.map((p) => {
    if (p.id !== id) return p;
    if (name !== undefined) return { ...p, name };
    const rest = { ...p };
    delete rest.name;
    return rest;
  });
  return { ...drawing, parts };
}

/**
 * First free SPICE id with this prefix (`R1`, `R2`…). SPICE ids are case
 * insensitive, so `r2` takes `R2`: with `R1` and `r2` used, this gives `R3`.
 */
export function nextId(drawing: Drawing, prefix: string): string {
  const used = new Set(drawing.parts.map((p) => p.id.toUpperCase()));
  let n = 1;
  while (used.has(`${prefix}${n}`.toUpperCase())) n++;
  return `${prefix}${n}`;
}
