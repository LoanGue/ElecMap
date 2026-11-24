/**
 * Zoom and pan for a scrolling box that holds a drawing.
 *
 * - Ctrl + wheel (or a trackpad pinch) zooms around the pointer; the wheel
 *   alone scrolls as usual.
 * - The middle button, or the left button with Space held, pans. With
 *   `panWithPrimary`, the left button pans too once the pointer has moved a
 *   few pixels, and the click that ends a pan is swallowed.
 * - The box redraws its content at the new scale in `onZoom`; the point under
 *   the pointer (or the centre) stays in place.
 */

export interface ViewportOptions {
  /** Draws the content at this scale (synchronously). */
  onZoom: (scale: number) => void;
  /** The left button pans the empty background (read-only drawings). */
  panWithPrimary?: boolean;
  min?: number;
  max?: number;
}

/** Steps of the zoom buttons. */
const STEP = 1.25;

let spaceHeld = false;
window.addEventListener("keydown", (e) => {
  const el = e.target as HTMLElement;
  if (e.code === "Space" && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) spaceHeld = true;
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") spaceHeld = false;
});
window.addEventListener("blur", () => (spaceHeld = false));

export class Viewport {
  scale = 1;
  /** The scale was chosen by the user (the drawing is no longer fitted). */
  manual = false;
  private readonly min: number;
  private readonly max: number;
  private pan:
    { id: number; x: number; y: number; left: number; top: number; moved: boolean } | undefined;

  constructor(
    readonly box: HTMLElement,
    private readonly options: ViewportOptions,
  ) {
    this.min = options.min ?? 0.25;
    this.max = options.max ?? 4;
    box.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    // Capture: a pan starts before the drawing's own handlers see the press.
    box.addEventListener("pointerdown", (e) => this.onDown(e), true);
    box.addEventListener("pointermove", (e) => this.onMove(e), true);
    box.addEventListener("pointerup", (e) => this.onUp(e), true);
    box.addEventListener("pointercancel", (e) => this.onUp(e), true);
    // The middle button would start the browser's autoscroll.
    box.addEventListener("mousedown", (e) => {
      if (e.button === 1) e.preventDefault();
    });
  }

  /** Sets the scale, keeping the point at `anchor` (client coordinates) still. */
  zoomTo(scale: number, anchor?: { x: number; y: number }, manual = true): void {
    const s = Math.min(this.max, Math.max(this.min, scale));
    this.manual = manual;
    if (Math.abs(s - this.scale) < 1e-6) return;
    const box = this.box;
    const r = box.getBoundingClientRect();
    const ax = anchor ? anchor.x - r.left : box.clientWidth / 2;
    const ay = anchor ? anchor.y - r.top : box.clientHeight / 2;
    const cx = (box.scrollLeft + ax) / this.scale;
    const cy = (box.scrollTop + ay) / this.scale;
    this.scale = s;
    this.options.onZoom(s);
    box.scrollLeft = cx * s - ax;
    box.scrollTop = cy * s - ay;
  }

  zoomIn(): void {
    this.zoomTo(this.scale * STEP);
  }

  zoomOut(): void {
    this.zoomTo(this.scale / STEP);
  }

  /** Fits a drawing of `width` × `height` (at scale 1) in the box, up to `limit`. */
  fit(width: number, height: number, limit = 1.25): void {
    const box = this.box;
    const pad = 32;
    const s = Math.min(
      limit,
      (box.clientWidth - pad) / Math.max(width, 1),
      (box.clientHeight - pad) / Math.max(height, 1),
    );
    this.zoomTo(s > 0 ? s : 1, undefined, false);
    box.scrollLeft = 0;
    box.scrollTop = 0;
  }

  private onWheel(e: WheelEvent): void {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    // Mouse wheels give ±100 per notch, trackpad pinches a few units.
    const delta = Math.max(-100, Math.min(100, e.deltaY));
    this.zoomTo(this.scale * Math.exp(-delta * 0.0022), { x: e.clientX, y: e.clientY });
  }

  private onDown(e: PointerEvent): void {
    const middle = e.button === 1;
    const primary = e.button === 0 && (spaceHeld || this.options.panWithPrimary === true);
    if (!middle && !primary) return;
    this.pan = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      left: this.box.scrollLeft,
      top: this.box.scrollTop,
      // Middle button and Space pan at once; a plain drag after a few pixels.
      moved: middle || spaceHeld,
    };
    if (this.pan.moved) this.start(e);
  }

  private start(e: PointerEvent): void {
    e.preventDefault();
    e.stopImmediatePropagation();
    this.box.classList.add("vp-panning");
    try {
      this.box.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
  }

  private onMove(e: PointerEvent): void {
    const p = this.pan;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved) {
      if (Math.hypot(dx, dy) < 4) return;
      p.moved = true;
      this.start(e);
    }
    e.stopImmediatePropagation();
    this.box.scrollLeft = p.left - dx;
    this.box.scrollTop = p.top - dy;
  }

  private onUp(e: PointerEvent): void {
    const p = this.pan;
    if (!p || p.id !== e.pointerId) return;
    this.pan = undefined;
    if (!p.moved) return;
    e.stopImmediatePropagation();
    this.box.classList.remove("vp-panning");
    // The click that follows a pan is not a click on the drawing.
    const swallow = (c: Event) => {
      c.stopImmediatePropagation();
      c.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
  }
}
