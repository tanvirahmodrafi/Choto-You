import type { Vector2 } from '@/movement/types';
import { createLogger } from '@/utils/logger';
import type { DisplayManager } from './DisplayManager';
import type { DisplayInfo } from './types';

const log = createLogger('DISPLAY');

/**
 * How long the cursor must sit on another display before the companion
 * follows, in seconds.
 *
 * Without a delay the companion would chase the pointer across displays every
 * time it passed over one, which is the opposite of restful. The requirement
 * is explicit: do not teleport constantly.
 */
const SWITCH_DELAY_SECONDS = 3;

/**
 * Works out which display the user is actually working on.
 *
 * The signal is the cursor's position, which is already being polled for
 * interaction. A focused-window signal would be more accurate but needs
 * accessibility permission, which is far too much to ask for deciding where a
 * cartoon robot stands.
 */
export class ActiveMonitorDetector {
  private candidate: DisplayInfo | null = null;
  private candidateFor = 0;

  constructor(private readonly displays: DisplayManager) {}

  /**
   * Advances the detector.
   *
   * @param cursor the cursor position in logical points, or null if unknown
   * @param current the display the companion is on now
   * @returns a display to move to, or null to stay put
   */
  update(delta: number, cursor: Vector2 | null, current: DisplayInfo): DisplayInfo | null {
    if (!cursor) return null;

    const under = this.displays.displayContaining(cursor);
    if (!under || under.id === current.id) {
      // Back on the companion's own display: cancel any pending switch.
      this.candidate = null;
      this.candidateFor = 0;
      return null;
    }

    if (this.candidate?.id !== under.id) {
      // A new candidate starts its dwell now. The current delta still counts
      // towards it, so the wait measures real elapsed time rather than
      // silently discarding the first frame.
      this.candidate = under;
      this.candidateFor = 0;
    }

    this.candidateFor += delta;
    if (this.candidateFor < SWITCH_DELAY_SECONDS) return null;

    log.info(`User has moved to "${under.name}"`);
    this.candidate = null;
    this.candidateFor = 0;
    return under;
  }

  reset(): void {
    this.candidate = null;
    this.candidateFor = 0;
  }
}
