import { createLogger } from '@/utils/logger';
import type { DisplayManager } from './DisplayManager';

const log = createLogger('DISPLAY');

/**
 * How often the monitor layout is re-read, in milliseconds.
 *
 * Deliberately slow. Display configuration changes are rare, human-initiated
 * events, and this process runs all day; a tight poll would burn CPU
 * continuously to notice something that happens a few times a week. Three
 * seconds is fast enough that a disconnected monitor is handled before the
 * user could act on it, and slow enough to be free in practice.
 */
const POLL_INTERVAL_MS = 3000;

/**
 * Watches for monitor connect/disconnect, resolution, scaling and arrangement
 * changes, and reports when the layout differs.
 *
 * Polling is used rather than an OS notification because Tauri exposes no
 * cross-platform display-change event. `DisplayManager.refresh` compares the
 * layout and does nothing when it is unchanged, so a poll that finds no change
 * costs one cheap call into the OS.
 */
export class DisplayWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private checking = false;

  constructor(
    private readonly displays: DisplayManager,
    private readonly onChange: () => void,
  ) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.check(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Forces an immediate check, e.g. after the window fails to move. */
  async checkNow(): Promise<void> {
    await this.check();
  }

  private async check(): Promise<void> {
    // A slow enumeration must not queue up behind itself.
    if (this.checking) return;
    this.checking = true;
    try {
      const changed = await this.displays.refresh();
      if (changed) {
        log.info('Display configuration changed');
        this.onChange();
      }
    } catch (error) {
      log.error('Failed to read the display layout', error);
    } finally {
      this.checking = false;
    }
  }
}
