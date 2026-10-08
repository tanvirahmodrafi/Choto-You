/**
 * Geometry types for movement.
 *
 * Everything here is in **physical pixels in virtual-desktop coordinates**:
 * the single coordinate space that spans every monitor. The origin is the
 * primary display's top-left, so other monitors legitimately have negative
 * x and/or y. Nothing in the movement layer may assume otherwise.
 */

export interface Vector2 {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type Direction = 'left' | 'right';

export const rectRight = (rect: Rect): number => rect.x + rect.width;
export const rectBottom = (rect: Rect): number => rect.y + rect.height;

export function rectContains(rect: Rect, point: Vector2): boolean {
  return (
    point.x >= rect.x &&
    point.x < rectRight(rect) &&
    point.y >= rect.y &&
    point.y < rectBottom(rect)
  );
}

/** Do two rectangles overlap at all? Touching edges do not count. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < rectRight(b) && b.x < rectRight(a) && a.y < rectBottom(b) && b.y < rectBottom(a);
}

export function clamp(value: number, min: number, max: number): number {
  // Guard the inverted case: if the companion is wider than the work area,
  // min would exceed max and a naive clamp would return nonsense.
  if (min > max) return min;
  return Math.min(max, Math.max(min, value));
}
