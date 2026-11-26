/**
 * Undo history of the block editor: snapshots of the state taken before each
 * action. A gesture made of many small changes (a drag) opens with `begin()`
 * and closes with `commit()`, so it undoes in one step.
 *
 * Pure and generic: no DOM, the editor owns the current state.
 */

export interface HistoryOptions<S> {
  /** Most undo steps kept; the oldest go first. Default 200. */
  cap?: number;
  /** Copy taken of every snapshot, so later edits in place do not reach it. Default `structuredClone`. */
  copy?: (state: S) => S;
}

export interface History<S> {
  /** Records the state before an action and clears redo. Ignored inside a gesture. */
  push(before: S): void;
  /** Opens a gesture: `before` becomes its single undo step once committed. */
  begin(before: S): void;
  /** Closes the gesture; `changed: false` (a click that moved nothing) records nothing. */
  commit(changed?: boolean): void;
  /** Steps back: the state to restore, or undefined when there is nothing to undo. */
  undo(current: S): S | undefined;
  /** Steps forward again after an undo, or undefined when there is nothing to redo. */
  redo(current: S): S | undefined;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Forgets every step, for a new or loaded drawing. */
  clear(): void;
}

export const HISTORY_CAP = 200;

export function createHistory<S>(options: HistoryOptions<S> = {}): History<S> {
  const cap = Math.max(1, options.cap ?? HISTORY_CAP);
  const copy = options.copy ?? ((s: S) => structuredClone(s));
  let past: S[] = [];
  let future: S[] = [];
  let open: { before: S } | undefined;

  const record = (before: S): void => {
    past.push(before);
    if (past.length > cap) past = past.slice(past.length - cap);
    future = [];
  };

  return {
    push(before) {
      if (!open) record(copy(before));
    },
    begin(before) {
      if (!open) open = { before: copy(before) };
    },
    commit(changed = true) {
      if (open && changed) record(open.before);
      open = undefined;
    },
    undo(current) {
      open = undefined;
      const back = past.pop();
      if (back === undefined) return undefined;
      future.push(copy(current));
      return back;
    },
    redo(current) {
      open = undefined;
      const next = future.pop();
      if (next === undefined) return undefined;
      past.push(copy(current));
      return next;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    clear() {
      past = [];
      future = [];
      open = undefined;
    },
  };
}
