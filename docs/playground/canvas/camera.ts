/**
 * Camera of the canvas editor: a uniform scale and an offset between world
 * coordinates (the scene) and screen coordinates (CSS pixels of the canvas).
 * Pure values and functions; the device pixel ratio is always passed in.
 *
 * `screen = world * scale + offset`.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Camera {
  /** Screen pixels per world unit. */
  scale: number;
  /** Screen position of the world origin. */
  x: number;
  y: number;
}

/** World rectangle, same shape as the engine's `GridBounds`. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Size of the canvas in CSS pixels. */
export interface Viewport {
  width: number;
  height: number;
}

export interface ScaleLimits {
  min: number;
  max: number;
}

/** Default zoom range, for a world measured in schematic pixels (20 per grid cell). */
export const SCALE_LIMITS: ScaleLimits = { min: 0.1, max: 8 };

export const IDENTITY_CAMERA: Camera = { scale: 1, x: 0, y: 0 };

export function clampScale(scale: number, limits: ScaleLimits = SCALE_LIMITS): number {
  return Math.min(limits.max, Math.max(limits.min, scale));
}

export function toScreen(cam: Camera, p: Pt): Pt {
  return { x: p.x * cam.scale + cam.x, y: p.y * cam.scale + cam.y };
}

export function toWorld(cam: Camera, p: Pt): Pt {
  return { x: (p.x - cam.x) / cam.scale, y: (p.y - cam.y) / cam.scale };
}

/** Moves the view by a screen distance (the scene follows the pointer). */
export function panBy(cam: Camera, dx: number, dy: number): Camera {
  return { scale: cam.scale, x: cam.x + dx, y: cam.y + dy };
}

/**
 * Multiplies the scale by `factor` (clamped) while the world point under
 * `screen` stays under it.
 */
export function zoomAt(
  cam: Camera,
  screen: Pt,
  factor: number,
  limits: ScaleLimits = SCALE_LIMITS,
): Camera {
  const scale = clampScale(cam.scale * factor, limits);
  const world = toWorld(cam, screen);
  return { scale, x: screen.x - world.x * scale, y: screen.y - world.y * scale };
}

/**
 * Camera showing `bounds` centred in the viewport, with `margin` screen pixels
 * kept free on every side. An empty extent zooms to the limit.
 */
export function fit(
  bounds: Bounds,
  viewport: Viewport,
  margin = 0,
  limits: ScaleLimits = SCALE_LIMITS,
): Camera {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const free = (size: number, extent: number) =>
    extent > 0 ? Math.max(0, size - 2 * margin) / extent : Infinity;
  const scale = clampScale(Math.min(free(viewport.width, w), free(viewport.height, h)), limits);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { scale, x: viewport.width / 2 - cx * scale, y: viewport.height / 2 - cy * scale };
}

/** World rectangle covered by the viewport (to draw only what is visible). */
export function visibleWorld(cam: Camera, viewport: Viewport): Bounds {
  const a = toWorld(cam, { x: 0, y: 0 });
  const b = toWorld(cam, { x: viewport.width, y: viewport.height });
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
}

/** `ctx.setTransform` arguments drawing world coordinates on a backing store of ratio `dpr`. */
export function deviceTransform(
  cam: Camera,
  dpr: number,
): [number, number, number, number, number, number] {
  const s = cam.scale * dpr;
  return [s, 0, 0, s, cam.x * dpr, cam.y * dpr];
}

/** Backing-store size of a canvas shown at `viewport` CSS pixels on a screen of ratio `dpr`. */
export function backingSize(viewport: Viewport, dpr: number): Viewport {
  return {
    width: Math.max(1, Math.round(viewport.width * dpr)),
    height: Math.max(1, Math.round(viewport.height * dpr)),
  };
}
