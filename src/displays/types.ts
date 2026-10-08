import type { Rect, Vector2 } from '@/movement/types';

/**
 * A monitor as the companion sees it.
 *
 * `bounds` and `workArea` are in **logical points**, which is the only space in
 * which the virtual desktop is coherent when displays have different scale
 * factors. The OS reports monitor geometry in physical pixels, each scaled by
 * that monitor's own factor, so in physical space two touching displays can
 * appear to have a huge gap between them:
 *
 *   external  scale 1  physical (0,0) 2560x1440   -> logical (0,0)    2560x1440
 *   laptop    scale 2  physical (1042,2880) 3024x1964 -> logical (521,1440) 1512x982
 *
 * Physically those look 1440px apart; logically they touch exactly at y=1440.
 *
 * Neither rect is assumed to start at (0,0): a display above or to the left of
 * the primary one has negative coordinates, and that is ordinary input.
 */
export interface DisplayInfo {
  /** Stable across layout changes; derived from the OS-reported monitor name. */
  readonly id: string;
  readonly name: string;
  /** Logical points. */
  readonly bounds: Rect;
  /** Logical points, excluding the taskbar/dock and menu bar. */
  readonly workArea: Rect;
  /**
   * The raw physical rect, kept only to map physical values the OS hands us
   * (notably the cursor position) back into logical space.
   */
  readonly physicalBounds: Rect;
  readonly scaleFactor: number;
  readonly isPrimary: boolean;
}

/** Squared distance from a point to the nearest spot inside a rectangle. */
export function squaredDistanceToRect(rect: Rect, point: Vector2): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return dx * dx + dy * dy;
}

export function rectCenter(rect: Rect): Vector2 {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}
