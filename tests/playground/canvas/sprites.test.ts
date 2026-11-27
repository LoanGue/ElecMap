import { describe, expect, it } from "vitest";
import type { ComponentJSON, Orientation } from "../../../src";
import {
  buildSprite,
  CELL,
  keyText,
  SpriteCache,
  spriteKey,
} from "../../../docs/playground/canvas/sprites";
import type { Sprite, SpriteKey, Variant } from "../../../docs/playground/canvas/sprites";
import type { DrawOp } from "../../../docs/playground/canvas/svg-ops";
import { PALETTE } from "../../../docs/playground/model";
import type { Kind, Part } from "../../../docs/playground/model";
import { placed } from "../../../docs/playground/symbols";

const part = (kind: Kind, dir: Orientation = "right", extra: Partial<Part> = {}): Part => ({
  id: "X1",
  kind,
  x: 7,
  y: 5,
  dir,
  value: "",
  ...extra,
});

/** Absolute vertices of an op's path (M, L, H, V), through its transform. */
function vertices(o: DrawOp): [number, number][] {
  if (o.op !== "path") return [];
  const out: [number, number][] = [];
  let [x, y] = [0, 0];
  for (const [, cmd, args = ""] of o.d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const v = args
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (cmd === "M" || cmd === "L") [x, y] = [v[0] ?? 0, v[1] ?? 0];
    else if (cmd === "H") x = v[0] ?? 0;
    else if (cmd === "V") y = v[0] ?? 0;
    else continue;
    const [a, b, c, d, e, f] = o.transform;
    out.push([a * x + c * y + e, b * x + d * y + f]);
  }
  return out;
}

/** Extreme points of an op (path vertices, circle and rect corners), through its transform. */
function extent(o: DrawOp): [number, number][] {
  const local: [number, number][] =
    o.op === "circle"
      ? [
          [o.cx - o.r, o.cy],
          [o.cx + o.r, o.cy],
          [o.cx, o.cy - o.r],
          [o.cx, o.cy + o.r],
        ]
      : o.op === "rect"
        ? [
            [o.x, o.y],
            [o.x + o.width, o.y + o.height],
          ]
        : [];
  const [a, b, c, d, e, f] = o.transform;
  return [
    ...vertices(o),
    ...local.map(([x, y]): [number, number] => [a * x + c * y + e, b * x + d * y + f]),
  ];
}

/** World vertices of a sprite drawn for part `p`. */
function drawn(s: Sprite, p: Part): [number, number][] {
  const dx = p.x * CELL - s.anchor.x;
  const dy = p.y * CELL - s.anchor.y;
  return s.ops.flatMap(vertices).map(([x, y]) => [x + dx, y + dy]);
}

describe("playground canvas sprites", () => {
  it("returns the same sprite object for the same key", () => {
    const cache = new SpriteCache();
    const a = cache.get(spriteKey(part("resistor"), "iec"));
    expect(cache.get(spriteKey(part("resistor"), "iec"))).toBe(a);
    expect(cache.size).toBe(1);
  });

  it("builds different sprites for IEC and ANSI symbols", () => {
    const cache = new SpriteCache();
    const iec = cache.get(spriteKey(part("resistor"), "iec"));
    const ansi = cache.get(spriteKey(part("resistor"), "ansi"));
    expect(ansi).not.toBe(iec);
    expect(ansi.ops).not.toEqual(iec.ops);
  });

  it("shares one sprite between parts that differ only by id, name and value", () => {
    const cache = new SpriteCache();
    const r1 = part("resistor", "down", { id: "R1", value: "1k" });
    const r2 = part("resistor", "down", { id: "R2", name: "R_load", value: "47k", x: 30 });
    expect(keyText(spriteKey(r1, "iec"))).toBe(keyText(spriteKey(r2, "iec")));
    expect(cache.get(spriteKey(r1, "iec"))).toBe(cache.get(spriteKey(r2, "iec")));
  });

  it("ignores the direction of parts that do not rotate", () => {
    expect(spriteKey(part("opamp", "down"), "iec")).toEqual(spriteKey(part("opamp"), "iec"));
    expect(spriteKey(part("npn", "left"), "iec").orientation).toBe("right");
  });

  it("keys the visual variants a value switches", () => {
    const variant = (p: Part, info?: ComponentJSON) => spriteKey(p, "ansi", info).variant;
    expect(variant(part("switch", "right", { value: "OFF" }))).toBe("open");
    expect(variant(part("switch", "right", { value: "ON" }))).toBe("");
    expect(variant(part("bsource", "right", { value: "I=V(a)" }))).toBe("current");
    const sine = { id: "V1", type: "vsource", nodes: ["a", "0"], ac: { mag: 1 } };
    expect(variant(part("vsource"), sine as unknown as ComponentJSON)).toBe("sine");
    const key = spriteKey(part("switch", "right", { value: "OFF" }), "iec");
    expect(buildSprite(key).ops).not.toEqual(buildSprite({ ...key, variant: "" }).ops);
  });

  it("puts the pins where placed() says they are", () => {
    const dirs: Orientation[] = ["right", "down", "left", "up"];
    for (const kind of PALETTE) {
      for (const dir of dirs) {
        const p = part(kind, dir);
        const points = drawn(buildSprite(spriteKey(p, "iec")), p);
        for (const pin of placed(p, ["a", "b", "c"], undefined).pins) {
          const hit = points.some(
            ([x, y]) => Math.abs(x - pin.x * CELL) < 0.01 && Math.abs(y - pin.y * CELL) < 0.01,
          );
          expect(hit, `${kind} ${dir} pin ${pin.x},${pin.y}`).toBe(true);
        }
      }
    }
  });

  it("keeps the anchor inside the sprite bounds", () => {
    for (const kind of PALETTE) {
      const s = buildSprite(spriteKey(part(kind), "iec"));
      expect(s.anchor.x).toBeGreaterThan(0);
      expect(s.anchor.x).toBeLessThan(s.bounds.width);
      expect(s.anchor.y).toBeGreaterThan(0);
      expect(s.anchor.y).toBeLessThan(s.bounds.height);
    }
  });
  it("keeps open and closed switches apart in the cache", () => {
    const cache = new SpriteCache();
    const on = cache.get(spriteKey(part("switch", "right", { value: "ON" }), "iec"));
    const off = cache.get(spriteKey(part("switch", "right", { value: "OFF" }), "iec"));
    expect(off).not.toBe(on);
    expect(cache.size).toBe(2);
  });

  it("draws the zener, sine and current variants differently", () => {
    const pairs: [Kind, Variant][] = [
      ["diode", "zener"],
      ["vsource", "sine"],
      ["bsource", "current"],
    ];
    for (const [kind, variant] of pairs) {
      const key: SpriteKey = { kind, orientation: "right", style: "ansi", variant: "" };
      expect(buildSprite({ ...key, variant }).ops, kind).not.toEqual(buildSprite(key).ops);
    }
    const diode = { id: "D1", type: "diode", nodes: ["a", "b"] };
    const info = (c: object) => c as unknown as ComponentJSON;
    expect(spriteKey(part("diode"), "iec", info(diode)).variant).toBe("");
    expect(spriteKey(part("diode"), "iec", info({ ...diode, bv: 5.1 })).variant).toBe("zener");
  });

  it("keeps every op inside the sprite bounds", () => {
    const variants: Variant[] = ["", "open", "current", "sine", "zener"];
    for (const kind of PALETTE)
      for (const style of ["iec", "ansi"] as const)
        for (const orientation of ["right", "down", "left", "up"] as const)
          for (const variant of variants) {
            const s = buildSprite({ kind, orientation, style, variant });
            for (const [x, y] of s.ops.flatMap(extent)) {
              const at = `${kind} ${style} ${orientation} ${variant} ${x},${y}`;
              expect(x, at).toBeGreaterThanOrEqual(s.bounds.x - 0.01);
              expect(y, at).toBeGreaterThanOrEqual(s.bounds.y - 0.01);
              expect(x, at).toBeLessThanOrEqual(s.bounds.x + s.bounds.width + 0.01);
              expect(y, at).toBeLessThanOrEqual(s.bounds.y + s.bounds.height + 0.01);
            }
          }
  });
});
