import { clamp, rectBottom, rectRight, type Rect, type Vector2 } from './types';

/**
 * Keeps the companion inside the region it is allowed to occupy.
 *
 * The companion must never become permanently unreachable, so every position
 * the movement engine produces passes through here before it is applied.
 */
export class BoundaryDetector {
  /**
   * @param bounds the usable work area (excluding taskbar/dock)
   * @param size   the companion window's size in physical pixels
   */
  constructor(
    private bounds: Rect,
    private size: { width: number; height: number },
  ) {}

  setBounds(bounds: Rect): void {
    this.bounds = bounds;
  }

  setSize(size: { width: number; height: number }): void {
    this.size = size;
  }

  get currentBounds(): Rect {
    return this.bounds;
  }

  /** The companion window's size in physical pixels. */
  get companionSize(): { readonly width: number; readonly height: number } {
    return this.size;
  }

  /** Leftmost window x that keeps the companion fully on screen. */
  get minX(): number {
    return this.bounds.x;
  }

  get maxX(): number {
    return rectRight(this.bounds) - this.size.width;
  }

  get minY(): number {
    return this.bounds.y;
  }

  /** The y at which the companion is standing on the bottom of the work area. */
  get groundY(): number {
    return rectBottom(this.bounds) - this.size.height;
  }

  clampPosition(position: Vector2): Vector2 {
    return {
      x: clamp(position.x, this.minX, this.maxX),
      y: clamp(position.y, this.minY, this.groundY),
    };
  }

  /**
   * True when the position needs no correction.
   *
   * Defined as "clamping would not move it" rather than as its own set of
   * comparisons, so it cannot disagree with `clampPosition`. It used to: when
   * the companion is larger than the work area the horizontal range inverts,
   * and the straightforward `x <= maxX` test rejected every position including
   * the one `safePosition` offers — which left the callers that correct an
   * invalid position re-correcting it on every check, forever.
   */
  isWithin(position: Vector2): boolean {
    const clamped = this.clampPosition(position);
    return clamped.x === position.x && clamped.y === position.y;
  }

  /** True when the companion is touching the left or right edge. */
  atHorizontalEdge(position: Vector2, tolerance = 1): 'left' | 'right' | null {
    if (position.x <= this.minX + tolerance) return 'left';
    if (position.x >= this.maxX - tolerance) return 'right';
    return null;
  }

  isGrounded(position: Vector2, tolerance = 1): boolean {
    return position.y >= this.groundY - tolerance;
  }

  /**
   * A guaranteed-safe position, used when a saved or computed one is invalid.
   *
   * The midpoint goes back through `clampPosition` rather than being returned
   * as computed: when the companion is larger than the work area `maxX` is
   * below `minX`, and the midpoint of that inverted range sits outside the
   * screen — which is exactly the situation this function exists to rescue.
   */
  safePosition(): Vector2 {
    const midpoint = { x: Math.round((this.minX + this.maxX) / 2), y: this.groundY };
    return this.clampPosition(midpoint);
  }
}
