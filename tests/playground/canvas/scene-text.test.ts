import { describe, expect, it } from "vitest";
import { scene } from "../../../docs/playground/canvas/scene";
import type { SceneOptions } from "../../../docs/playground/canvas/scene";
import {
  LABEL_FONT,
  NAME_FONT,
  sceneText,
  VALUE_FONT,
} from "../../../docs/playground/canvas/scene-text";
import type { TextFont, TextOptions } from "../../../docs/playground/canvas/scene-text";
import { SpriteCache } from "../../../docs/playground/canvas/sprites";
import { emptyDrawing } from "../../../docs/playground/model";
import type { Drawing, Part } from "../../../docs/playground/model";

const sceneOpts = (more: Partial<SceneOptions> = {}): SceneOptions => ({
  style: "iec",
  sprites: new SpriteCache(),
  ...more,
});

/** 7 px per character, id as name, value as is. */
const plain: TextOptions = {
  labelOf: (p) => ({ name: p.id, value: p.value }),
  measure: (text) => text.length * 7,
};

const texts = (d: Drawing, opts = plain, more: Partial<SceneOptions> = {}) =>
  sceneText(d, scene(d, sceneOpts(more)), opts);

const one = (p: Part, opts = plain) => texts({ ...emptyDrawing(), parts: [p] }, opts);

/** Text, anchor and box of each item. */
const brief = (items: ReturnType<typeof texts>) =>
  items.map((i) => [i.text, i.align, i.x, i.y, i.box]);

describe("canvas scene text", () => {
  it("centres the name above and the value below a horizontal two-pin part", () => {
    const p: Part = { id: "R1", kind: "resistor", x: 0, y: 0, dir: "right", value: "1k" };
    expect(brief(one(p))).toEqual([
      ["R1", "middle", 40, -25, { x: 33, y: -37, width: 14, height: 15 }],
      ["1k", "middle", 40, 37, { x: 33, y: 25, width: 14, height: 15 }],
    ]);
  });

  it("puts both lines right of a vertical two-pin part, one line on its middle", () => {
    const p: Part = { id: "R2", kind: "resistor", x: 0, y: 0, dir: "down", value: "1k" };
    expect(brief(one(p))).toEqual([
      ["R2", "start", 26, 37, { x: 26, y: 25, width: 14, height: 15 }],
      ["1k", "start", 26, 55, { x: 26, y: 43, width: 14, height: 15 }],
    ]);
    expect(brief(one({ ...p, value: "" }))).toEqual([
      ["R2", "start", 26, 46, { x: 26, y: 34, width: 14, height: 15 }],
    ]);
    const unnamed = { ...plain, labelOf: () => ({ name: "", value: "1k" }) };
    expect(brief(one(p, unnamed))).toEqual([
      ["1k", "start", 26, 46, { x: 26, y: 34, width: 14, height: 15 }],
    ]);
  });

  it("uses fixed fonts: 12 px sans for parts, bold names, 12 px bold mono for labels", () => {
    expect(NAME_FONT).toEqual({ family: "sans", weight: 600, size: 12 });
    expect(VALUE_FONT).toEqual({ family: "sans", weight: 400, size: 12 });
    expect(LABEL_FONT).toEqual({ family: "mono", weight: 600, size: 12 });
  });

  it("writes an op-amp's name then its value one line lower, below the triangle", () => {
    const p: Part = { id: "U1", kind: "opamp", x: 10, y: 10, dir: "right", value: "TL071" };
    expect(brief(one(p))).toEqual([
      ["U1", "start", 156, 252, { x: 156, y: 240, width: 14, height: 15 }],
      ["TL071", "start", 156, 264, { x: 156, y: 252, width: 35, height: 15 }],
    ]);
    const unnamed = { ...plain, labelOf: () => ({ name: "", value: "TL071" }) };
    expect(brief(one(p, unnamed))).toEqual([
      ["TL071", "start", 156, 264, { x: 156, y: 252, width: 35, height: 15 }],
    ]);
  });

  it("writes a BJT's name and value right of its body", () => {
    const p: Part = { id: "Q1", kind: "npn", x: 0, y: 0, dir: "right", value: "2N3904" };
    expect(brief(one(p))).toEqual([
      ["Q1", "start", 32, 57, { x: 32, y: 45, width: 14, height: 15 }],
      ["2N3904", "start", 32, 75, { x: 32, y: 63, width: 42, height: 15 }],
    ]);
  });

  it("boxes a label's whole tag above its marker", () => {
    const d: Drawing = { ...emptyDrawing(), labels: [{ x: 6, y: 4, name: "out" }] };
    expect(texts(d)).toEqual([
      {
        owner: { kind: "label", index: 0 },
        text: "out",
        x: 121,
        y: 67,
        align: "start",
        font: LABEL_FONT,
        hl: false,
        box: { x: 116, y: 54, width: 31, height: 18 },
      },
    ]);
  });

  it("uses the injected strings and widths, per font", () => {
    const fonts: TextFont[] = [];
    const opts: TextOptions = {
      labelOf: () => ({ name: "R_load", value: "10k" }),
      measure: (text, font) => {
        fonts.push(font);
        return text.length * (font.family === "mono" ? 8 : font.weight === 600 ? 10 : 6);
      },
    };
    const d: Drawing = {
      ...emptyDrawing(),
      parts: [{ id: "R1", kind: "resistor", x: 0, y: 0, dir: "right", value: "1k" }],
      labels: [{ x: 0, y: 0, name: "in" }],
    };
    const items = texts(d, opts);
    expect(items.map((i) => [i.owner, i.text, i.box.width])).toEqual([
      [{ kind: "part", id: "R1", role: "name" }, "R_load", 60],
      [{ kind: "part", id: "R1", role: "value" }, "10k", 18],
      [{ kind: "label", index: 0 }, "in", 26],
    ]);
    expect(items[0]?.box.x).toBe(10);
    expect(fonts).toEqual([NAME_FONT, VALUE_FONT, LABEL_FONT]);
  });

  it("highlights the texts of highlighted parts and of labels on highlighted nodes", () => {
    const d: Drawing = {
      ...emptyDrawing(),
      parts: [
        { id: "R1", kind: "resistor", x: 0, y: 0, dir: "right", value: "1k" },
        { id: "R2", kind: "resistor", x: 0, y: 4, dir: "right", value: "1k" },
      ],
      labels: [{ x: 4, y: 0, name: "out" }],
    };
    const items = texts(d, plain, {
      highlight: { parts: new Set(["R2"]), nodes: new Set(["out"]) },
    });
    expect(items.map((i) => [i.text, i.hl])).toEqual([
      ["R1", false],
      ["1k", false],
      ["R2", true],
      ["1k", true],
      ["out", true],
    ]);
  });
});
