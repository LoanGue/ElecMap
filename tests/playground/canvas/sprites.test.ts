import { describe, expect, it } from "vitest";
import type { ComponentJSON, Orientation } from "../../../src";
import {
  buildSprite,
  CELL,
  keyText,
  SpriteCache,
  spriteKey,
} from "../../../docs/playground/canvas/sprites";
import type { Sprite } from "../../../docs/playground/canvas/sprites";
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
});
