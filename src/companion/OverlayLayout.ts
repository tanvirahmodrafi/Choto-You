import { clamp, type Rect, type Vector2 } from '@/movement/types';

/**
 * Works out how big the overlay window must be, and where the character sits
 * inside it.
 *
 * The window is normally just the character — no larger than it needs to be,
 * so it intercepts as little of the desktop as possible. A speech bubble does
 * not fit in that, so while one is shown the window grows and the character
 * moves to a corner of it.
 *
 * Everything else in the app works in *character* coordinates. This module is
 * the only place that knows the window is sometimes bigger than the character,
 * which keeps that complication out of movement, boundaries and interaction.
 */

export interface BubbleMetrics {
  readonly width: number;
  readonly height: number;
  /**
   * Space between the bubble's box and the top of the character.
   *
   * It has to clear the trail of dots that joins the two, which hang below the
   * box in CSS and are not part of its measured height. Too small and the
   * lowest dot is drawn over the character's hair.
   */
  readonly gap: number;
}

export const DEFAULT_BUBBLE_METRICS: BubbleMetrics = { width: 240, height: 76, gap: 40 };

/** Which side of the character the bubble extends towards. */
export type BubbleSide = 'left' | 'right';

export interface OverlayLayout {
  /** Window size in logical points. */
  readonly windowSize: { readonly width: number; readonly height: number };
  /** Where the character box sits inside the window. */
  readonly characterOffset: Vector2;
  /** Where the bubble sits inside the window, or null when hidden. */
  readonly bubble: { readonly x: number; readonly y: number; readonly side: BubbleSide } | null;
  /** Horizontal centre of the character within the window; the tail points here. */
  readonly tailX: number;
}

export interface LayoutInput {
  readonly characterSize: { readonly width: number; readonly height: number };
  readonly characterPosition: Vector2;
  /** Work area of the display the character is on, in logical points. */
  readonly workArea: Rect;
  readonly bubbleVisible: boolean;
  readonly metrics?: BubbleMetrics;
}

/** The layout with no bubble: the window is exactly the character. */
export function characterOnlyLayout(characterSize: {
  readonly width: number;
  readonly height: number;
}): OverlayLayout {
  return {
    windowSize: characterSize,
    characterOffset: { x: 0, y: 0 },
    bubble: null,
    tailX: characterSize.width / 2,
  };
}

export function computeLayout(input: LayoutInput): OverlayLayout {
  const { characterSize, characterPosition, workArea, bubbleVisible } = input;
  if (!bubbleVisible) return characterOnlyLayout(characterSize);

  const metrics = input.metrics ?? DEFAULT_BUBBLE_METRICS;
  const windowWidth = Math.max(characterSize.width, metrics.width);
  const windowHeight = metrics.height + metrics.gap + characterSize.height;

  // Prefer opening to the right, but flip near the right edge so the bubble
  // never runs off the display. Measured against the character's centre.
  const characterCentre = characterPosition.x + characterSize.width / 2;
  const overflowRight = characterCentre + metrics.width - characterSize.width / 2;
  const side: BubbleSide = overflowRight > workArea.x + workArea.width ? 'left' : 'right';

  // The character sits at one end of the wider window so the bubble has room
  // on the other side.
  const characterOffsetX = side === 'right' ? 0 : windowWidth - characterSize.width;

  const layout: OverlayLayout = {
    windowSize: { width: windowWidth, height: windowHeight },
    characterOffset: { x: characterOffsetX, y: metrics.height + metrics.gap },
    bubble: { x: 0, y: 0, side },
    tailX: characterOffsetX + characterSize.width / 2,
  };
  return layout;
}

/**
 * Converts a character position into the window origin for a given layout.
 *
 * The window must also stay on screen: when the character is near the top of
 * the work area there is no room for the bubble above it, so the window is
 * pushed down and the bubble is drawn closer to the character instead.
 */
export function windowOriginFor(
  layout: OverlayLayout,
  characterPosition: Vector2,
  workArea: Rect,
): Vector2 {
  const desired = {
    x: characterPosition.x - layout.characterOffset.x,
    y: characterPosition.y - layout.characterOffset.y,
  };
  return {
    x: clamp(desired.x, workArea.x, workArea.x + workArea.width - layout.windowSize.width),
    y: clamp(desired.y, workArea.y, workArea.y + workArea.height - layout.windowSize.height),
  };
}

/**
 * Where the character actually ends up once the window has been clamped.
 *
 * Used for the hitbox: if the window was pushed to stay on screen, the
 * character moved with it, and clicks must follow.
 */
export function characterRectFor(
  layout: OverlayLayout,
  windowOrigin: Vector2,
  characterSize: { readonly width: number; readonly height: number },
): Rect {
  return {
    x: windowOrigin.x + layout.characterOffset.x,
    y: windowOrigin.y + layout.characterOffset.y,
    width: characterSize.width,
    height: characterSize.height,
  };
}
