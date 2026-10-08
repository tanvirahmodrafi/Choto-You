import type { NormalizedRect } from '@/types/character';
import type { Rect, Vector2 } from '@/movement/types';

/**
 * Turns the character's normalised hitbox into a rectangle in virtual-desktop
 * coordinates.
 *
 * The overlay window is mostly transparent padding. Treating the whole window
 * as the character would block clicks on whatever is underneath, so every
 * interaction test uses this rectangle instead of the window bounds.
 *
 * @param windowPosition top-left of the overlay window, physical pixels
 * @param windowSize     overlay window size, physical pixels
 * @param hitbox         fractions of the frame, from the character manifest
 */
export function hitboxRect(
  windowPosition: Vector2,
  windowSize: { readonly width: number; readonly height: number },
  hitbox: NormalizedRect,
): Rect {
  return {
    x: windowPosition.x + hitbox.x * windowSize.width,
    y: windowPosition.y + hitbox.y * windowSize.height,
    width: hitbox.width * windowSize.width,
    height: hitbox.height * windowSize.height,
  };
}

export function pointInRect(rect: Rect, point: Vector2): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * Distance from a point to the nearest edge of a rectangle, or 0 inside it.
 * Used for proximity reactions, so the character notices an approaching cursor
 * before it actually touches.
 */
export function distanceToRect(rect: Rect, point: Vector2): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

/** Which way the character should face to look at a point. */
export function directionToward(rect: Rect, point: Vector2): 'left' | 'right' {
  return point.x < rect.x + rect.width / 2 ? 'left' : 'right';
}
