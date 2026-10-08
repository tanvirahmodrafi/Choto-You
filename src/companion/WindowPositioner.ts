import { LogicalSize, PhysicalPosition, getCurrentWindow } from '@tauri-apps/api/window';
import type { Vector2 } from '@/movement/types';
import { createLogger } from '@/utils/logger';

const log = createLogger('MOVE');

export interface WindowFrame {
  /** Window origin in logical points. */
  readonly origin: Vector2;
  /** Window size in logical points. */
  readonly size: { readonly width: number; readonly height: number };
}

/**
 * Applies the companion's frame to the real OS window.
 *
 * Every update crosses the IPC boundary, so redundant work is filtered out
 * here: values are rounded to whole points, unchanged frames are skipped, and
 * only one update is ever in flight. Without the in-flight guard a slow frame
 * would queue moves faster than they complete and the window would lag behind
 * the simulation.
 */
export class WindowPositioner {
  private readonly window = getCurrentWindow();
  private applied: WindowFrame | null = null;
  private pending: WindowFrame | null = null;
  private inFlight = false;
  private failures = 0;

  /** Temporarily logs every applied frame; far too noisy for normal use. */
  diagnostics = false;

  /**
   * @param toPhysical converts a logical point using the scale factor of the
   *                   display it lands on. Passing logical coordinates to Tauri
   *                   directly is wrong across displays of differing DPI — it
   *                   would use the window's current scale factor instead.
   */
  constructor(private readonly toPhysical: (point: Vector2) => Vector2) {}

  /** Records where the window already is, so the first update is not skipped. */
  prime(frame: WindowFrame): void {
    this.applied = round(frame);
  }

  apply(frame: WindowFrame): void {
    const next = round(frame);
    if (this.applied && sameFrame(this.applied, next)) return;

    if (this.inFlight) {
      // Keep only the newest frame: intermediate ones are already stale.
      this.pending = next;
      return;
    }
    void this.send(next);
  }

  private async send(frame: WindowFrame): Promise<void> {
    this.inFlight = true;
    try {
      // Resize before moving. Growing the window for a speech bubble while it
      // sits at the bottom of the screen would otherwise push it off-screen
      // for a frame before the move corrects it.
      if (!this.applied || !sameSize(this.applied, frame)) {
        await this.window.setSize(new LogicalSize(frame.size.width, frame.size.height));
      }
      const physical = this.toPhysical(frame.origin);
      await this.window.setPosition(
        new PhysicalPosition(Math.round(physical.x), Math.round(physical.y)),
      );

      this.applied = frame;
      this.failures = 0;
      if (this.diagnostics) {
        log.debug(
          `frame ${frame.size.width}x${frame.size.height} at logical (${frame.origin.x},${frame.origin.y})`,
        );
      }
    } catch (error) {
      // Log the first failure only; a broken window would otherwise flood the
      // log at frame rate.
      if (this.failures === 0) log.error('Failed to apply the companion window frame', error);
      this.failures++;
    } finally {
      this.inFlight = false;
      const queued = this.pending;
      this.pending = null;
      if (queued) void this.send(queued);
    }
  }
}

function round(frame: WindowFrame): WindowFrame {
  return {
    origin: { x: Math.round(frame.origin.x), y: Math.round(frame.origin.y) },
    size: { width: Math.round(frame.size.width), height: Math.round(frame.size.height) },
  };
}

function sameSize(a: WindowFrame, b: WindowFrame): boolean {
  return a.size.width === b.size.width && a.size.height === b.size.height;
}

function sameFrame(a: WindowFrame, b: WindowFrame): boolean {
  return a.origin.x === b.origin.x && a.origin.y === b.origin.y && sameSize(a, b);
}
