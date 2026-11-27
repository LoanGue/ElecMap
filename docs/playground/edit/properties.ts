/**
 * Part property edits from the editor's side panel: a part's value and its
 * display name, the only part fields the panel edits (rotation and removal
 * are operations). Label renaming lives in `operations.ts`. Pure functions of
 * the drawing: each returns the same drawing object when nothing changes, so
 * a caller can compare references to skip an undo step.
 */
import type { Drawing, Part } from "../model";
import { rename } from "./naming";

/** Drawing with `part` swapped for `next`, or the same drawing when equal. */
function replacePart(drawing: Drawing, part: Part, next: Part): Drawing {
  if (next === part) return drawing;
  return { ...drawing, parts: drawing.parts.map((p) => (p === part ? next : p)) };
}

/**
 * Drawing where part `id` has the netlist value `text`, trimmed (`1k`,
 * `DC 5 AC 1`, `NPN`). An empty value is kept: the netlist check reports it.
 * An unknown id, or the same value, leaves the drawing unchanged.
 */
export function setValue(drawing: Drawing, id: string, text: string): Drawing {
  const part = drawing.parts.find((p) => p.id === id);
  if (!part) return drawing;
  const value = text.trim();
  return replacePart(drawing, part, value === part.value ? part : { ...part, value });
}

/**
 * Drawing where part `id` shows `text` as its display name, through
 * `rename`: blank text brings back the default name, and the SPICE id never
 * changes. An unknown id, or the same name, leaves the drawing unchanged.
 */
export function setName(drawing: Drawing, id: string, text: string): Drawing {
  const part = drawing.parts.find((p) => p.id === id);
  if (!part) return drawing;
  const next = rename(drawing, id, text);
  const renamed = next.parts.find((p) => p.id === id);
  return renamed?.name === part.name ? drawing : next;
}
