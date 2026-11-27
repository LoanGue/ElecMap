/**
 * Text of the canvas scene: the name and value of each part and the name of
 * each net label, in world pixels (`CELL` per grid unit), placed as the SVG
 * editor places them (`placed().labelAt` read by `renderSvg`, the label tag of
 * editor.ts). Each item has a box, the edit target for hit testing. Strings
 * and text widths are injected: no DOM, no canvas.
 */
import type { Drawing, Part } from "../model";
import { placed } from "../symbols";
import type { Scene } from "./scene";
import { CELL } from "./sprites";

/** Font of a text item; the painter maps it to a CSS font. */
export interface TextFont {
  family: "sans" | "mono";
  weight: 400 | 600;
  /** Size in world pixels. */
  size: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a text belongs to and which of its strings it shows. */
export type TextOwner =
  { kind: "part"; id: string; role: "name" | "value" } | { kind: "label"; index: number };

/** A line of text. The text is never rotated: the SVG editor keeps it upright. */
export interface TextItem {
  owner: TextOwner;
  text: string;
  /** Anchor on the baseline, in world pixels. */
  x: number;
  y: number;
  /** `start`: `x` is the left end; `middle`: `x` is the centre. */
  align: "start" | "middle";
  font: TextFont;
  hl: boolean;
  /** Box around the text (labels: their whole tag), in world pixels. */
  box: Box;
}

export interface TextOptions {
  /** Strings shown for a part; an empty string draws nothing. */
  labelOf: (p: Part) => { name: string; value: string };
  /** Width of `text` in `font`, in world pixels. */
  measure: (text: string, font: TextFont) => number;
}

export const NAME_FONT: TextFont = { family: "sans", weight: 600, size: 12 };
export const VALUE_FONT: TextFont = { family: "sans", weight: 400, size: 12 };
export const LABEL_FONT: TextFont = { family: "mono", weight: 600, size: 12 };

const r = (n: number): number => Math.round(n * 100) / 100;

/** Baseline anchors (grid units) of a part's name and value, as `renderSvg` draws them. */
function anchors(p: Part, both: boolean) {
  const { x, y, align } = placed(p, ["a", "b", "c"], undefined).labelAt;
  const line = NAME_FONT.size / CELL;
  // Op-amp and horizontal lines keep their place when the other line is empty.
  if (p.kind === "opamp")
    return { align: "start" as const, name: { x, y }, value: { x, y: y + line } };
  if (align === "middle") return { align, name: { x, y: y - 1.25 }, value: { x, y: y + 1.85 } };
  return {
    align: "start" as const,
    name: { x: x - 0.3, y: both ? y - 0.15 : y + 0.3 },
    value: { x: x - 0.3, y: both ? y + 0.75 : y + 0.3 },
  };
}

/** Box of a line: its measured width, from one font size above the baseline to a quarter below. */
function box(x: number, y: number, width: number, align: TextItem["align"], f: TextFont): Box {
  const left = align === "middle" ? x - width / 2 : x;
  return { x: r(left), y: r(y - f.size), width: r(width), height: r(f.size * 1.25) };
}

function partText(p: Part, hl: boolean, opts: TextOptions): TextItem[] {
  const { name, value } = opts.labelOf(p);
  const a = anchors(p, name !== "" && value !== "");
  const lines = [
    { role: "name" as const, text: name, at: a.name, font: NAME_FONT },
    { role: "value" as const, text: value, at: a.value, font: VALUE_FONT },
  ];
  return lines
    .filter((l) => l.text !== "")
    .map(({ role, text, at, font }) => {
      const x = r(at.x * CELL);
      const y = r(at.y * CELL);
      const width = opts.measure(text, font);
      const owner: TextOwner = { kind: "part", id: p.id, role };
      return { owner, text, x, y, align: a.align, font, hl, box: box(x, y, width, a.align, font) };
    });
}

/**
 * Label name at its tag: the text 1 px right of and 13 px above the marker,
 * the tag 4 px left of it, 26 px to 8 px above, 10 px wider than the text.
 */
function labelText(name: string, at: Scene["labels"][number], opts: TextOptions): TextItem {
  const width = opts.measure(name, LABEL_FONT);
  return {
    owner: { kind: "label", index: at.index },
    text: name,
    x: at.x + 1,
    y: at.y - 13,
    align: "start",
    font: LABEL_FONT,
    hl: at.hl,
    box: { x: at.x - 4, y: at.y - 26, width: r(width + 10), height: 18 },
  };
}

/** Text items of `d`, its highlight flags taken from its scene `s`. */
export function sceneText(d: Drawing, s: Scene, opts: TextOptions): TextItem[] {
  const hl = new Map(s.symbols.map((q) => [q.id, q.hl]));
  return [
    ...d.parts.flatMap((p) => partText(p, hl.get(p.id) ?? false, opts)),
    ...s.labels.flatMap((m) => {
      const l = d.labels[m.index];
      return l ? [labelText(l.name, m, opts)] : [];
    }),
  ];
}
