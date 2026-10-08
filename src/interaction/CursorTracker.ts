import { cursorPosition } from '@tauri-apps/api/window';
import type { Vector2 } from '@/movement/types';
import { createLogger } from '@/utils/logger';

const log = createLogger('APP');

/**
 * Polling intervals in milliseconds, chosen by how close the cursor is.
 *
 * The companion needs the *global* cursor position, which a webview cannot
 * observe while the window is click-through — so polling is unavoidable. The
 * cost is kept down by only polling quickly when it matters: slowly when the
 * cursor is nowhere near, quickly when it is close enough to interact, and at
 * roughly frame rate only while actually dragging.
 */
const INTERVAL_FAR_MS = 120;
const INTERVAL_NEAR_MS = 33;
const INTERVAL_DRAG_MS = 16;

export type TrackerMode = 'far' | 'near' | 'drag';

/**
 * Reports where the mouse cursor is, in virtual-desktop logical points.
 *
 * Uses a self-rescheduling timeout rather than an interval so the rate can
 * change between ticks, and so a slow poll can never queue up behind itself.
 */
export class CursorTracker {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private mode: TrackerMode = 'far';
  private running = false;
  private failures = 0;

  /**
   * @param onPosition  receives the cursor position in logical points
   * @param toLogical   converts the OS-reported physical position; the OS scales
   *                    each monitor by its own factor, so this cannot be a
   *                    single global divide
   */
  constructor(
    private readonly onPosition: (position: Vector2) => void,
    private readonly toLogical: (point: Vector2) => Vector2 = (point) => point,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Raises or lowers the poll rate. */
  setMode(mode: TrackerMode): void {
    this.mode = mode;
  }

  get currentMode(): TrackerMode {
    return this.mode;
  }

  private schedule(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => void this.poll(), this.intervalMs());
  }

  private intervalMs(): number {
    switch (this.mode) {
      case 'drag':
        return INTERVAL_DRAG_MS;
      case 'near':
        return INTERVAL_NEAR_MS;
      default:
        return INTERVAL_FAR_MS;
    }
  }

  private async poll(): Promise<void> {
    if (!this.running) return;
    try {
      const position = await cursorPosition();
      this.onPosition(this.toLogical({ x: position.x, y: position.y }));
      this.failures = 0;
    } catch (error) {
      // Log once rather than at poll rate; cursor position can legitimately
      // fail (for example while the screen is locked).
      if (this.failures === 0) log.warn('Could not read the cursor position', error);
      this.failures++;
    } finally {
      this.schedule();
    }
  }
}
