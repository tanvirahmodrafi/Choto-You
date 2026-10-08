import type { Vector2 } from '@/movement/types';
import { createLogger } from '@/utils/logger';

const log = createLogger('STATE');

/**
 * Notices when the user stops using the machine.
 *
 * Deliberately narrow: the only signal is whether the mouse cursor has moved,
 * which the companion already polls for its own interaction handling. Nothing
 * is recorded, nothing is sent anywhere, and no attempt is made to see what
 * the user is doing — only whether they appear to be there.
 *
 * Keyboard activity is not observed. Watching keystrokes would mean asking for
 * input-monitoring permission to decide whether to play a sleep animation,
 * which is not a trade worth making.
 */
export class IdleMonitor {
  private lastActivityAt: number;
  private lastCursor: Vector2 | null = null;
  private idle = false;

  /**
   * @param idleAfterSeconds how long without cursor movement counts as away
   * @param now injectable clock, so the behaviour can be tested without waiting
   */
  constructor(
    private idleAfterSeconds: number,
    private readonly now: () => number = Date.now,
  ) {
    this.lastActivityAt = this.now();
  }

  setIdleAfterSeconds(seconds: number): void {
    this.idleAfterSeconds = seconds;
  }

  get isIdle(): boolean {
    return this.idle;
  }

  get idleForSeconds(): number {
    return (this.now() - this.lastActivityAt) / 1000;
  }

  /** Feeds in a cursor position; movement counts as the user being present. */
  observeCursor(position: Vector2): void {
    const previous = this.lastCursor;
    this.lastCursor = position;
    if (!previous) return;

    // A tolerance keeps cursor jitter, and the sub-pixel drift of a trackpad
    // resting under a finger, from counting as activity.
    const moved = Math.abs(position.x - previous.x) + Math.abs(position.y - previous.y);
    if (moved > 2) this.markActive();
  }

  /** Records deliberate interaction, such as a click or a drag. */
  markActive(): void {
    this.lastActivityAt = this.now();
    if (this.idle) {
      this.idle = false;
      log.debug('User is back');
    }
  }

  /**
   * Re-evaluates idleness.
   * @returns true when the state changed on this call.
   */
  update(): boolean {
    const shouldBeIdle = this.idleForSeconds >= this.idleAfterSeconds;
    if (shouldBeIdle === this.idle) return false;
    this.idle = shouldBeIdle;
    log.debug(shouldBeIdle ? 'User appears to be away' : 'User is back');
    return true;
  }
}
