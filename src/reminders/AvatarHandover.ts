import { clamp, type Rect, type Vector2 } from '@/movement/types';
import { createLogger } from '@/utils/logger';

const log = createLogger('REMINDER');

/**
 * Stages of handing the desk over from the roaming character to the one a
 * reminder asked for, and back again.
 *
 * Written as an explicit sequence, like `PerformanceStage`, so the exchange is
 * readable in the log instead of being inferred from positions.
 */
export type HandoverStage =
  | 'idle'
  /** The roaming character runs off the nearer edge. */
  | 'clearing'
  /** Off screen, waiting for the visiting pack to finish loading. */
  | 'swapping'
  /** The visitor leans in from that edge before committing to the walk. */
  | 'peeking'
  /** The visitor walks in to the delivery spot. */
  | 'arriving'
  /** Standing still while the reminder plays out. */
  | 'present'
  /** The visitor walks back off the same edge. */
  | 'departing'
  /** Off screen again, waiting for the user's own pack to come back. */
  | 'restoring'
  /** The roaming character walks back to where it was standing. */
  | 'returning';

/** Which way the character is looking: out towards its edge, or into the screen. */
export type HandoverFacing = 'inward' | 'outward';

/** Running away is quicker than an ordinary stroll. */
const RUN_AWAY_SPEED = 2.4;
/** Sneaking in is slower, so the arrival is noticed. */
const SNEAK_SPEED = 0.7;
const DEPART_SPEED = 1.6;

/** How long the visitor hangs at the edge before walking in, in seconds. */
const PEEK_SECONDS = 1.1;

/**
 * How long an off-screen stage waits for an avatar before giving up.
 *
 * A pack that fails to load must not leave the companion parked beyond the
 * edge of the screen for good — the user has no way to suspect, let alone fix,
 * a companion that is simply not there.
 */
const SWAP_TIMEOUT_SECONDS = 6;

/**
 * The exchange between two avatars around a reminder, independent of frame
 * rate and of which pack is loaded.
 *
 * Free-roam mode has a character on screen already, so a reminder that belongs
 * to a *different* avatar cannot simply swap the artwork underneath it: the one
 * standing there would turn into someone else mid-stride. Instead the current
 * character leaves the way it would leave anywhere else — on foot — the visitor
 * walks in, says its piece and walks out, and the first one comes back to the
 * spot it was using.
 *
 * Positions are produced here and applied by the runtime, the same division
 * `ReminderVisit` uses for reminder-only appearances. Travel is speed-based
 * rather than on fixed durations so a character standing near the edge is not
 * made to crawl there, and so the walk matches the pack's own walking speed.
 */
export class AvatarHandover {
  stage: HandoverStage = 'idle';
  /** The edge the exchange happens at: whichever one was closer. */
  side: 'left' | 'right' = 'left';

  /** Walking speed in physical pixels per second. */
  private speed = 120;
  /** Where the roaming character was standing, and where it is put back. */
  private anchorX = 0;
  /**
   * The character's x *including* the part beyond the edge.
   *
   * The movement layer refuses to place the companion outside the work area —
   * correctly, since nothing else may strand it off screen — so leaving is
   * tracked here and rendered as a translation inside the window instead.
   */
  private virtualX = 0;
  private x = 0;
  private y = 0;
  private width = 1;
  private elapsed = 0;

  get isActive(): boolean {
    return this.stage !== 'idle';
  }

  /** True once the visitor is in place, which is when it may start speaking. */
  get isPresenting(): boolean {
    return this.stage === 'present';
  }

  /** The character's position in virtual-desktop coordinates, clamped on screen. */
  get position(): Vector2 {
    return { x: this.x, y: this.y };
  }

  /** How far the character is beyond its edge, in character widths: -1 to 1. */
  get offset(): number {
    return (this.virtualX - this.x) / this.width;
  }

  get facing(): HandoverFacing {
    return this.stage === 'clearing' || this.stage === 'departing' ? 'outward' : 'inward';
  }

  /** Walking speed of the pack on screen, in physical pixels per second. */
  setSpeed(pixelsPerSecond: number): void {
    if (pixelsPerSecond > 0) this.speed = pixelsPerSecond;
  }

  /** Sends the roaming character off, remembering the spot for its return. */
  start(anchorX: number, bounds: Rect, size: { width: number; height: number }): void {
    this.anchorX = anchorX;
    this.virtualX = anchorX;
    this.side = this.nearerEdge(anchorX, bounds, size);
    this.enter('clearing');
    this.update(0, bounds, size);
  }

  /** Ends the visit: the visitor walks out and the roaming character returns. */
  leave(): void {
    if (this.stage === 'idle' || this.stage === 'departing') return;
    // From a stage that is already off screen there is nothing to walk out of.
    this.enter(this.stage === 'swapping' || this.stage === 'restoring' ? 'restoring' : 'departing');
  }

  /**
   * Reports that the pack requested for the current off-screen stage is ready.
   *
   * The stages either side of a swap are the only ones where the character is
   * invisible, so a slow load is absorbed there rather than showing the wrong
   * avatar walking in.
   */
  avatarReady(): void {
    if (this.stage === 'swapping') this.enter('peeking');
    else if (this.stage === 'restoring') this.enter('returning');
  }

  /**
   * Abandons the exchange wherever it had got to.
   *
   * The part of the character that was beyond the edge is brought back inside
   * its window: an abandoned handover has no sequence left to finish the slide,
   * and a permanently half-clipped companion is the worst outcome available.
   */
  reset(): void {
    this.stage = 'idle';
    this.elapsed = 0;
    this.virtualX = this.x;
  }

  update(delta: number, bounds: Rect, size: { width: number; height: number }): void {
    if (this.stage === 'idle') return;
    this.elapsed += Math.max(0, delta);
    this.width = Math.max(1, size.width);

    const sign = this.side === 'left' ? -1 : 1;
    const left = bounds.x;
    const right = Math.max(left, bounds.x + bounds.width - size.width);
    const edge = this.side === 'left' ? left : right;
    const away = edge + sign * this.width;
    const centre = Math.round((left + right) / 2);

    switch (this.stage) {
      case 'clearing':
        if (this.travel(away, RUN_AWAY_SPEED, delta)) this.enter('swapping');
        break;

      case 'swapping':
        this.virtualX = away;
        if (this.elapsed >= SWAP_TIMEOUT_SECONDS) {
          log.warn('Visiting avatar is taking too long; going on without it');
          this.enter('peeking');
        }
        break;

      case 'peeking': {
        // Half out, tilted by the renderer: the look of someone checking the
        // room before stepping into it.
        const progress = Math.min(1, this.elapsed / PEEK_SECONDS);
        this.virtualX = away - sign * 0.5 * this.width * progress;
        if (progress >= 1) this.enter('arriving');
        break;
      }

      case 'arriving':
        if (this.travel(centre, SNEAK_SPEED, delta)) this.enter('present');
        break;

      case 'present':
        this.virtualX = centre;
        break;

      case 'departing':
        if (this.travel(away, DEPART_SPEED, delta)) this.enter('restoring');
        break;

      case 'restoring':
        this.virtualX = away;
        if (this.elapsed >= SWAP_TIMEOUT_SECONDS) {
          log.warn('Roaming avatar is taking too long; bringing it back anyway');
          this.enter('returning');
        }
        break;

      case 'returning':
        // `enter`, not `reset`: the walk home ended on the anchor, and that is
        // the position to keep.
        if (this.travel(clamp(this.anchorX, left, right), 1, delta)) this.enter('idle');
        break;

      default:
        break;
    }

    this.x = clamp(this.virtualX, left, right);
    // The same ground the companion walks on the rest of the time.
    this.y = bounds.y + Math.max(0, bounds.height - size.height);
  }

  /** Advances towards an x, reporting whether it was reached. */
  private travel(target: number, multiplier: number, delta: number): boolean {
    const remaining = target - this.virtualX;
    const step = this.speed * multiplier * Math.max(0, delta);
    if (Math.abs(remaining) <= step) {
      this.virtualX = target;
      return true;
    }
    this.virtualX += Math.sign(remaining) * step;
    return false;
  }

  private nearerEdge(
    anchorX: number,
    bounds: Rect,
    size: { width: number; height: number },
  ): 'left' | 'right' {
    const left = bounds.x;
    const right = Math.max(left, bounds.x + bounds.width - size.width);
    return anchorX - left <= right - anchorX ? 'left' : 'right';
  }

  private enter(stage: HandoverStage): void {
    log.debug(`handover ${this.stage} -> ${stage}`);
    this.stage = stage;
    this.elapsed = 0;
  }
}
