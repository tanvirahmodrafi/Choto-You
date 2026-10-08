import type { Rect, Vector2 } from '@/movement/types';
import { createLogger } from '@/utils/logger';
import { CursorTracker } from './CursorTracker';
import { distanceToRect, pointInRect } from './Hitbox';
import type { InteractionConfig, InteractionEvents } from './types';
import { DEFAULT_INTERACTION_CONFIG } from './types';

const log = createLogger('STATE');

/** Sets whether clicks pass through the overlay to whatever is underneath. */
export type ClickThroughSetter = (ignore: boolean) => void;

export interface InteractionDeps {
  /** The character's clickable rectangle, in virtual-desktop coordinates. */
  readonly getHitbox: () => Rect;
  readonly setClickThrough: ClickThroughSetter;
  readonly events: InteractionEvents;
  /** Converts an OS-reported physical cursor position into logical points. */
  readonly toLogical?: (point: Vector2) => Vector2;
  readonly now?: () => number;
}

/**
 * Turns raw cursor positions and pointer events into companion interactions.
 *
 * The central problem it solves: the overlay is a small transparent window, and
 * the user must still be able to click whatever is behind it. So the window is
 * click-through by default and only becomes solid while the cursor is actually
 * over the character's hitbox — which requires watching the global cursor
 * position, because a click-through window receives no events of its own.
 */
export class InteractionController {
  private config: InteractionConfig;
  private readonly tracker: CursorTracker;
  private clickThrough: boolean | null = null;
  private overHitbox = false;
  private near = false;
  private dragging = false;
  private dragOffset: Vector2 = { x: 0, y: 0 };
  private lastClickAt = 0;
  private pendingClick: ReturnType<typeof setTimeout> | null = null;
  private cursor: Vector2 | null = null;
  /** Temporarily logs every hit test; far too noisy for normal use. */
  diagnostics = false;

  constructor(
    private readonly deps: InteractionDeps,
    config: InteractionConfig = DEFAULT_INTERACTION_CONFIG,
  ) {
    this.config = config;
    this.tracker = new CursorTracker(
      (position) => this.updateCursor(position),
      deps.toLogical ?? ((point) => point),
    );
  }

  start(): void {
    this.tracker.start();
    // Start click-through: until the cursor is known to be over the character,
    // the overlay must not intercept anything.
    this.applyClickThrough(true);
  }

  stop(): void {
    this.tracker.stop();
    this.cancelPendingClick();
    this.applyClickThrough(true);
  }

  setConfig(config: InteractionConfig): void {
    this.config = config;
    if (!config.enabled) {
      this.applyClickThrough(true);
      this.tracker.setMode('far');
    }
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  get cursorPosition(): Vector2 | null {
    return this.cursor;
  }

  // --- cursor polling -----------------------------------------------------

  /**
   * Feeds in a new cursor position. Normally called by the tracker; public so
   * the interaction rules can be driven directly in tests without polling.
   */
  updateCursor(position: Vector2): void {
    this.cursor = position;
    // Reported before any early return: idle detection must still see the
    // cursor while the companion is being dragged or interaction is off.
    this.deps.events.onCursorMoved(position);

    if (this.dragging) {
      this.deps.events.onDrag({
        x: position.x - this.dragOffset.x,
        y: position.y - this.dragOffset.y,
      });
      return;
    }

    if (!this.config.enabled) return;

    const hitbox = this.deps.getHitbox();
    const over = pointInRect(hitbox, position);
    if (this.diagnostics) {
      log.debug(
        `cursor (${Math.round(position.x)},${Math.round(position.y)}) vs hitbox ` +
          `x ${Math.round(hitbox.x)}..${Math.round(hitbox.x + hitbox.width)} ` +
          `y ${Math.round(hitbox.y)}..${Math.round(hitbox.y + hitbox.height)} -> ${over}`,
      );
    }
    const distance = distanceToRect(hitbox, position);
    const near = distance <= this.config.proximityRadius;

    if (over !== this.overHitbox) {
      this.overHitbox = over;
      // Solid only while the cursor is on the character; transparent padding
      // never blocks the desktop.
      this.applyClickThrough(!over);
    }

    if (near !== this.near) {
      this.near = near;
      this.tracker.setMode(near ? 'near' : 'far');
      if (this.config.trackCursor) {
        this.deps.events.onProximityChange(near, near ? position : null);
      }
    } else if (near && this.config.trackCursor) {
      this.deps.events.onProximityChange(true, position);
    }
  }

  private applyClickThrough(ignore: boolean): void {
    if (this.clickThrough === ignore) return;
    this.clickThrough = ignore;
    log.debug(ignore ? 'cursor left the character; clicks pass through' : 'cursor over the character; clicks captured');
    this.deps.setClickThrough(ignore);
  }

  // --- pointer events from the character element ---------------------------

  /**
   * Called on pointerdown over the character.
   * @param cursor global cursor position
   * @param windowPosition current overlay window position
   */
  handlePointerDown(button: number, cursor: Vector2, windowPosition: Vector2): void {
    if (!this.config.enabled) return;

    if (button === 2) {
      log.debug('RIGHT_CLICK');
      this.deps.events.onRightClick(cursor);
      return;
    }
    if (button !== 0 || !this.config.draggable) return;

    // Remember where inside the window the character was grabbed, so it does
    // not snap its top-left corner to the cursor.
    this.dragOffset = { x: cursor.x - windowPosition.x, y: cursor.y - windowPosition.y };
    this.dragging = true;
    this.tracker.setMode('drag');
    log.debug('DRAG_START');
    this.deps.events.onDragStart();
  }

  /** Called on pointerup. Distinguishes a click from the end of a drag. */
  handlePointerUp(moved: boolean): void {
    if (!this.config.enabled) return;

    const wasDragging = this.dragging;
    if (wasDragging) {
      this.dragging = false;
      this.tracker.setMode(this.near ? 'near' : 'far');
      log.debug('DRAG_END');
      this.deps.events.onDragEnd();
    }

    // A pointer that travelled is a drag, not a click.
    if (moved) return;
    this.registerClick();
  }

  /**
   * Resolves single versus double click.
   *
   * A single click is deliberately delayed by the double-click window: firing
   * it immediately and then also firing a double click would play two
   * reactions on top of each other.
   */
  private registerClick(): void {
    const now = this.deps.now?.() ?? Date.now();
    const sinceLast = now - this.lastClickAt;
    this.lastClickAt = now;

    if (this.pendingClick !== null && sinceLast <= this.config.doubleClickMs) {
      this.cancelPendingClick();
      if (this.config.reactToDoubleClick) {
        log.debug('DOUBLE_CLICK');
        this.deps.events.onDoubleClick();
      }
      return;
    }

    if (!this.config.reactToClick) return;
    this.pendingClick = setTimeout(() => {
      this.pendingClick = null;
      log.debug('USER_CLICK');
      this.deps.events.onClick();
    }, this.config.doubleClickMs);
  }

  private cancelPendingClick(): void {
    if (this.pendingClick === null) return;
    clearTimeout(this.pendingClick);
    this.pendingClick = null;
  }
}
