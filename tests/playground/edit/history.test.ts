import { describe, expect, it } from "vitest";
import { createHistory, HISTORY_CAP } from "../../../docs/playground/edit/history";

interface State {
  x: number;
}

const undoAll = (h: ReturnType<typeof createHistory<number>>, from: number): number[] => {
  const out: number[] = [];
  let current = from;
  for (let back = h.undo(current); back !== undefined; back = h.undo(current)) {
    out.push(back);
    current = back;
  }
  return out;
};

describe("undo history", () => {
  it("undoes and redoes actions in order, then returns undefined", () => {
    const h = createHistory<number>();
    expect(h.undo(0)).toBeUndefined();
    h.push(0);
    h.push(1);
    expect(h.undo(2)).toBe(1);
    expect(h.undo(1)).toBe(0);
    expect(h.undo(0)).toBeUndefined();
    expect(h.redo(0)).toBe(1);
    expect(h.redo(1)).toBe(2);
    expect(h.redo(2)).toBeUndefined();
  });

  it("undoes a whole drag in one step", () => {
    const h = createHistory<State>();
    let s: State = { x: 0 };
    h.begin(s);
    for (let x = 1; x <= 5; x++) {
      h.push(s);
      s = { x };
    }
    h.commit();
    expect(h.undo(s)).toEqual({ x: 0 });
    expect(h.canUndo).toBe(false);
    expect(h.redo({ x: 0 })).toEqual({ x: 5 });
  });

  it("records nothing for a gesture that changed nothing", () => {
    const h = createHistory<number>();
    h.begin(0);
    h.commit(false);
    expect(h.canUndo).toBe(false);
  });

  it("clears redo on a new action", () => {
    const h = createHistory<number>();
    h.push(0);
    h.undo(1);
    expect(h.canRedo).toBe(true);
    h.push(0);
    expect(h.canRedo).toBe(false);
    expect(h.redo(7)).toBeUndefined();
  });

  it("clears redo when a gesture commits", () => {
    const h = createHistory<number>();
    h.push(0);
    h.undo(1);
    h.begin(0);
    h.commit();
    expect(h.canRedo).toBe(false);
  });

  it("keeps a snapshot safe from later edits in place", () => {
    const h = createHistory<State>();
    const s = { x: 0 };
    h.push(s);
    s.x = 1;
    expect(h.undo(s)).toEqual({ x: 0 });
    s.x = 2;
    expect(h.redo({ x: 0 })).toEqual({ x: 1 });
  });

  it("keeps the most recent steps up to the cap", () => {
    const small = createHistory<number>({ cap: 3 });
    for (let i = 0; i < 10; i++) small.push(i);
    expect(undoAll(small, 10)).toEqual([9, 8, 7]);

    const h = createHistory<number>();
    for (let i = 0; i < HISTORY_CAP + 50; i++) h.push(i);
    expect(undoAll(h, -1)).toHaveLength(200);
  });

  it("forgets every step on clear", () => {
    const h = createHistory<number>();
    h.push(0);
    h.push(1);
    h.undo(2);
    h.clear();
    expect([h.canUndo, h.canRedo]).toEqual([false, false]);
  });
});
