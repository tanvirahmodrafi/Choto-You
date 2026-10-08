import type { SettingsRepository } from '@/database/SettingsRepository';
import type { Vector2 } from '@/movement/types';
import type { SavedPosition } from '@/settings/types';
import { createLogger } from '@/utils/logger';

const log = createLogger('DB');

/**
 * How long the position must stay still before it is written, in milliseconds.
 *
 * The companion moves at frame rate; writing every step would mean thousands
 * of disk writes an hour for a value only ever read once, at startup. Writing
 * after it settles costs one write per walk.
 */
const SETTLE_MS = 4000;

/**
 * Remembers where the companion was, without hammering the disk.
 *
 * Nothing is written while the character is moving — only once it has been
 * still for a few seconds, and once more on shutdown so the very last
 * position is not lost.
 */
export class PositionStore {
  private pending: SavedPosition | null = null;
  private written: SavedPosition | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly repository: SettingsRepository) {}

  /** Records the current position; the write happens once it settles. */
  record(displayId: string, position: Vector2): void {
    const next: SavedPosition = {
      displayId,
      x: Math.round(position.x),
      y: Math.round(position.y),
    };
    if (this.written && sameAs(this.written, next)) return;
    this.pending = next;

    // Restarting the timer on every move is what makes this "settled for N
    // seconds" rather than "every N seconds".
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), SETTLE_MS);
  }

  /** Writes immediately, e.g. on shutdown. */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const position = this.pending;
    if (!position || (this.written && sameAs(this.written, position))) return;

    try {
      await this.repository.savePosition(position);
      this.written = position;
    } catch (error) {
      log.error('Failed to save the companion position', error);
    }
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

function sameAs(a: SavedPosition, b: SavedPosition): boolean {
  return a.displayId === b.displayId && a.x === b.x && a.y === b.y;
}
