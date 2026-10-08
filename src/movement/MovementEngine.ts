import { createLogger } from '@/utils/logger';
import { BoundaryDetector } from './BoundaryDetector';
import { clamp, type Direction, type Rect, type Vector2 } from './types';

const log = createLogger('MOVE');

export type MovementMode = 'idle' | 'walking' | 'falling' | 'held';

/** Why a walk ended. */
export type SettleReason = 'arrived' | 'cancelled';

export interface MovementSnapshot {
  readonly position: Vector2;
  readonly direction: Direction;
  readonly mode: MovementMode;
  readonly grounded: boolean;
}

export interface MovementConfig {
  /** Walking speed in physical pixels per second. */
  readonly walkSpeed: number;
  /** Downward acceleration in physical pixels per second squared. */
  readonly gravity: number;
  /** Terminal downward speed, so a long fall stays controllable. */
  readonly maxFallSpeed: number;
}

export const DEFAULT_MOVEMENT_CONFIG: MovementConfig = {
  walkSpeed: 120,
  gravity: 2400,
  maxFallSpeed: 2000,
};

/**
 * Owns the companion's position, velocity and facing.
 *
 * All motion is delta-time based, never per-frame-constant, so the companion
 * moves at the same speed on a 60Hz and a 120Hz display and does not lurch
 * after the loop is throttled.
 *
 * The engine deliberately knows nothing about *why* it is moving — behaviour
 * picks targets, the engine carries them out and reports what happened.
 */
export class MovementEngine {
  private position: Vector2;
  private velocityY = 0;
  private direction: Direction = 'right';
  private mode: MovementMode = 'idle';
  private targetX: number | null = null;
  private onSettled: ((reason: SettleReason) => void) | undefined;
  private snapshot: MovementSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly boundaries: BoundaryDetector,
    start: Vector2,
    private config: MovementConfig = DEFAULT_MOVEMENT_CONFIG,
  ) {
    this.position = boundaries.clampPosition(start);
    this.snapshot = this.buildSnapshot();
  }

  getSnapshot(): MovementSnapshot {
    return this.snapshot;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setConfig(config: MovementConfig): void {
    this.config = config;
  }

  /**
   * Walks to an x position, clamped into the usable area.
   *
   * `onSettled` is always called exactly once — with `'arrived'` on success, or
   * `'cancelled'` if the walk is abandoned (the user grabs the companion, or
   * the display layout changes under it). Callers that only listened for
   * arrival could otherwise wait forever and wedge the behaviour layer.
   */
  walkTo(x: number, onSettled?: (reason: SettleReason) => void): void {
    this.cancelTarget();
    const target = clamp(Math.round(x), this.boundaries.minX, this.boundaries.maxX);
    this.targetX = target;
    this.onSettled = onSettled;
    this.direction = target < this.position.x ? 'left' : 'right';
    this.mode = 'walking';
    this.publish();
  }

  /**
   * Turns to face a point without moving. Used for cursor tracking, where the
   * character should notice the pointer but not chase it.
   */
  faceToward(targetX: number): void {
    const centre = this.position.x + this.boundaries.companionSize.width / 2;
    const direction: Direction = targetX < centre ? 'left' : 'right';
    if (direction === this.direction) return;
    this.direction = direction;
    this.publish();
  }

  stop(): void {
    this.cancelTarget();
    this.publish();
  }

  /**
   * Drops any walk in progress and leaves the companion idle.
   *
   * Resetting the mode matters as much as clearing the target: a mode left at
   * 'walking' with no target would never move and never complete, freezing the
   * companion permanently.
   */
  private cancelTarget(): void {
    const notify = this.onSettled;
    this.targetX = null;
    this.onSettled = undefined;
    if (this.mode === 'walking') this.mode = 'idle';
    notify?.('cancelled');
  }

  /**
   * Places the companion directly, e.g. while being dragged or when a display
   * appears, disappears or is re-ordered underneath it.
   *
   * A walk in progress is abandoned rather than left dangling: `walkTo`
   * promises exactly one settle callback, and a behaviour layer still waiting
   * for one would never pick a new destination — the companion would stand in
   * place for good, with nothing in the log to say why.
   */
  setPosition(position: Vector2, mode: MovementMode = this.mode): void {
    const notify = this.onSettled;
    this.targetX = null;
    this.onSettled = undefined;
    this.position = this.boundaries.clampPosition(position);
    this.mode = mode;
    this.velocityY = 0;
    this.publish();
    // Last, so a listener that starts a new walk sees the position it is
    // actually walking from.
    notify?.('cancelled');
  }

  /**
   * Re-validates the current position against the current bounds.
   *
   * Called after the work area changes (monitor added, removed, resized, or
   * the window resized). If the companion is outside the usable region it is
   * moved to the nearest valid spot rather than left somewhere unreachable.
   */
  revalidate(): void {
    if (this.boundaries.isWithin(this.position)) return;
    const corrected = this.boundaries.clampPosition(this.position);
    log.warn('Position outside work area; correcting', {
      from: this.position,
      to: corrected,
    });
    this.position = corrected;
    this.cancelTarget();
    this.publish();
  }

  update(delta: number): void {
    if (this.mode === 'held') return;

    const previous = this.position;
    const previousMode = this.mode;
    let { x, y } = this.position;

    if (this.mode === 'walking' && this.targetX !== null) {
      const remaining = this.targetX - x;
      const step = this.config.walkSpeed * delta;
      if (Math.abs(remaining) <= step) {
        x = this.targetX;
        this.targetX = null;
        this.mode = 'idle';
        const callback = this.onSettled;
        this.onSettled = undefined;
        // Apply the final position before announcing arrival, so a listener
        // that immediately picks a new target sees the correct starting point.
        this.position = { x, y };
        this.publish();
        callback?.('arrived');
        return;
      }
      x += Math.sign(remaining) * step;
      this.direction = remaining < 0 ? 'left' : 'right';
    }

    // Gravity applies whenever the companion is above the ground, whatever the
    // reason — released from a drag, or left floating when a monitor changed.
    const groundY = this.boundaries.groundY;
    if (y < groundY) {
      this.mode = this.mode === 'walking' ? this.mode : 'falling';
      this.velocityY = Math.min(this.velocityY + this.config.gravity * delta, this.config.maxFallSpeed);
      y = Math.min(y + this.velocityY * delta, groundY);
      if (y >= groundY) {
        this.velocityY = 0;
        if (this.mode === 'falling') this.mode = 'idle';
      }
    } else {
      // Already standing on the floor. A fall that is over has to be declared
      // over here as well as on touchdown above: a crossing to the display
      // *above* arrives standing on its floor, so the fall never has a frame
      // in which it is airborne. A mode left at 'falling' would then never
      // clear — the companion looks idle but wandering, roaming and the
      // position store all skip it, and it stands there until something else
      // moves it.
      this.velocityY = 0;
      if (this.mode === 'falling') this.mode = 'idle';
    }

    const next = this.boundaries.clampPosition({ x, y });
    if (next.x === previous.x && next.y === previous.y && this.mode === previousMode) return;
    this.position = next;
    this.publish();
  }

  /** Starts a fall from the current position, used when a drag is released. */
  release(): void {
    this.mode = this.boundaries.isGrounded(this.position) ? 'idle' : 'falling';
    this.velocityY = 0;
    this.publish();
  }

  hold(): void {
    this.cancelTarget();
    this.mode = 'held';
    this.velocityY = 0;
    this.publish();
  }

  /** Called when the work area changes; keeps the companion reachable. */
  onBoundsChanged(bounds: Rect): void {
    this.boundaries.setBounds(bounds);
    this.revalidate();
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of [...this.listeners]) listener();
  }

  private buildSnapshot(): MovementSnapshot {
    return {
      position: this.position,
      direction: this.direction,
      mode: this.mode,
      grounded: this.boundaries.isGrounded(this.position),
    };
  }
}
