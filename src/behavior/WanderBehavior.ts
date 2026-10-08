import type { AnimationPlayer } from '@/animation/AnimationPlayer';
import { AnimationPriority } from '@/animation/types';
import type { BoundaryDetector } from '@/movement/BoundaryDetector';
import type { MovementEngine } from '@/movement/MovementEngine';
import { createLogger } from '@/utils/logger';

const log = createLogger('STATE');

export interface WanderConfig {
  /** Shortest and longest pause between walks, in seconds. */
  readonly minPause: number;
  readonly maxPause: number;
  /** Shortest walk worth taking, in physical pixels. */
  readonly minDistance: number;
}

export const DEFAULT_WANDER_CONFIG: WanderConfig = {
  minPause: 2,
  maxPause: 7,
  minDistance: 120,
};

/**
 * Provisional idle behaviour: pause, pick somewhere to walk, walk there, repeat.
 *
 * This is deliberately minimal. Phase 6 replaces it with the full state
 * machine and weighted random-action engine; it exists now so Phase 3 has
 * something to drive the movement engine and prove it works.
 */
export class WanderBehavior {
  private pauseRemaining: number;
  private walking = false;

  constructor(
    private readonly movement: MovementEngine,
    private readonly boundaries: BoundaryDetector,
    private readonly player: AnimationPlayer,
    private readonly config: WanderConfig = DEFAULT_WANDER_CONFIG,
    private readonly random: () => number = Math.random,
  ) {
    this.pauseRemaining = this.nextPause();
  }

  update(delta: number): void {
    if (this.walking) return;

    this.pauseRemaining -= delta;
    if (this.pauseRemaining > 0) return;

    const target = this.pickTarget();
    if (target === null) {
      // Nowhere worth walking to (a very narrow work area); wait and re-check.
      this.pauseRemaining = this.nextPause();
      return;
    }

    this.walking = true;
    log.debug(`IDLE -> WALKING (target x=${target})`);
    this.player.play('walk', { priority: AnimationPriority.NORMAL });
    this.movement.walkTo(target, (reason) => {
      this.walking = false;
      this.pauseRemaining = this.nextPause();
      log.debug(`WALKING -> IDLE (${reason})`);
      // A cancelled walk hands control to whatever cancelled it (a drag, a
      // monitor transition), so do not force an idle animation over it.
      if (reason === 'arrived') {
        this.player.play('idle', { priority: AnimationPriority.AMBIENT, force: true });
      }
    });
  }

  /** Cancels any walk in progress, e.g. when the user grabs the companion. */
  interrupt(): void {
    if (!this.walking) return;
    // `stop` settles the walk as cancelled, which clears `walking` via the
    // callback; the assignment here keeps it correct even without one.
    this.walking = false;
    this.movement.stop();
    this.pauseRemaining = this.nextPause();
  }

  private pickTarget(): number | null {
    const { minX, maxX } = this.boundaries;
    if (maxX - minX < this.config.minDistance) return null;

    const current = this.movement.getSnapshot().position.x;
    // Try a few times rather than looping forever on a narrow work area.
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = minX + this.random() * (maxX - minX);
      if (Math.abs(candidate - current) >= this.config.minDistance) {
        return Math.round(candidate);
      }
    }
    // Fall back to the far end, which is always far enough given the check above.
    return current - minX > maxX - current ? minX : maxX;
  }

  private nextPause(): number {
    const { minPause, maxPause } = this.config;
    return minPause + this.random() * (maxPause - minPause);
  }
}
