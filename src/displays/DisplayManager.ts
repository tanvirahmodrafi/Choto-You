import { availableMonitors, primaryMonitor, type Monitor } from '@tauri-apps/api/window';
import { rectContains, type Rect, type Vector2 } from '@/movement/types';
import { createLogger } from '@/utils/logger';
import { squaredDistanceToRect, type DisplayInfo } from './types';

const log = createLogger('DISPLAY');

/**
 * Enumerates monitors and answers geometry questions about them.
 *
 * The layout is read from the operating system every time, never assumed.
 * Monitors may be stacked vertically, offset diagonally, have different
 * resolutions and scale factors, and sit at negative coordinates.
 */
export class DisplayManager {
  private displays: readonly DisplayInfo[] = [];
  private readonly listeners = new Set<() => void>();

  get all(): readonly DisplayInfo[] {
    return this.displays;
  }

  get primary(): DisplayInfo | null {
    return this.displays.find((display) => display.isPrimary) ?? this.displays[0] ?? null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * Re-reads the monitor layout from the OS.
   * @returns true if the layout changed.
   */
  async refresh(): Promise<boolean> {
    const [monitors, primary] = await Promise.all([availableMonitors(), primaryMonitor()]);
    const ids = assignIds(monitors);
    const next = monitors.map((monitor, index) =>
      toDisplayInfo(monitor, index, primary, ids[index] ?? `Display ${index + 1}`),
    );

    if (next.length === 0) {
      // Keep the previous layout rather than adopting an empty one: better a
      // stale monitor than no coordinate space at all.
      log.error('OS reported no monitors; keeping the previous layout');
      return false;
    }

    if (sameLayout(this.displays, next)) return false;

    log.info(`Monitor layout: ${next.length} display(s)`, next.map(describe));
    this.displays = next;
    for (const listener of [...this.listeners]) listener();
    return true;
  }

  /** The display whose *bounds* contain the point, if any. */
  displayContaining(point: Vector2): DisplayInfo | null {
    return this.displays.find((display) => rectContains(display.bounds, point)) ?? null;
  }

  byId(id: string): DisplayInfo | null {
    return this.displays.find((display) => display.id === id) ?? null;
  }

  /**
   * Maps a physical point reported by the OS (such as the cursor position)
   * into the logical space everything else works in.
   */
  physicalToLogical(point: Vector2): Vector2 {
    const display =
      this.displays.find((candidate) => rectContains(candidate.physicalBounds, point)) ??
      this.nearestPhysical(point);
    if (!display) return point;
    const scale = display.scaleFactor;
    // Offsets are measured from the display's own origin so the result lands
    // inside that display's logical rect.
    return {
      x: display.bounds.x + (point.x - display.physicalBounds.x) / scale,
      y: display.bounds.y + (point.y - display.physicalBounds.y) / scale,
    };
  }

  /**
   * Maps a logical point into physical pixels, using the scale factor of the
   * display that point falls on.
   *
   * This cannot be a single global multiply, and it must not be left to the
   * toolkit: Tauri converts a `LogicalPosition` with the scale factor of the
   * display the window is *currently* on. Moving a window from a 1x display to
   * a 2x one would therefore be converted at 1x and land in the gap between
   * the two displays' physical rects, where nothing is visible.
   */
  logicalToPhysical(point: Vector2): Vector2 {
    const display = this.displayContaining(point) ?? this.nearestDisplay(point);
    if (!display) return point;
    const scale = display.scaleFactor;
    return {
      x: display.physicalBounds.x + (point.x - display.bounds.x) * scale,
      y: display.physicalBounds.y + (point.y - display.bounds.y) * scale,
    };
  }

  private nearestPhysical(point: Vector2): DisplayInfo | null {
    let best: DisplayInfo | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const display of this.displays) {
      const distance = squaredDistanceToRect(display.physicalBounds, point);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = display;
      }
    }
    return best;
  }

  /**
   * The display closest to a point. Used when a saved position refers to a
   * monitor that no longer exists, so the companion always has somewhere valid
   * to go rather than sitting at coordinates nothing can show.
   */
  nearestDisplay(point: Vector2): DisplayInfo | null {
    let best: DisplayInfo | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const display of this.displays) {
      const distance = squaredDistanceToRect(display.bounds, point);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = display;
      }
    }
    return best;
  }
}

function toDisplayInfo(
  monitor: Monitor,
  index: number,
  primary: Monitor | null,
  id: string,
): DisplayInfo {
  const scale = monitor.scaleFactor || 1;
  const physicalBounds: Rect = {
    x: monitor.position.x,
    y: monitor.position.y,
    width: monitor.size.width,
    height: monitor.size.height,
  };
  return {
    id,
    name: monitor.name ?? `Display ${index + 1}`,
    // Converted to logical points: see the note on DisplayInfo for why the
    // physical values cannot be compared across displays.
    bounds: toLogical(physicalBounds, scale),
    workArea: toLogical(
      {
        x: monitor.workArea.position.x,
        y: monitor.workArea.position.y,
        width: monitor.workArea.size.width,
        height: monitor.workArea.size.height,
      },
      scale,
    ),
    physicalBounds,
    scaleFactor: scale,
    isPrimary: primary !== null && samePosition(monitor, primary),
  };
}

function toLogical(rect: Rect, scale: number): Rect {
  return {
    x: Math.round(rect.x / scale),
    y: Math.round(rect.y / scale),
    width: Math.round(rect.width / scale),
    height: Math.round(rect.height / scale),
  };
}

/**
 * Builds ids that survive a layout change.
 *
 * An earlier version folded the enumeration index into the id, which meant
 * plugging in a monitor renumbered the others and the companion concluded the
 * display it was standing on had been unplugged. Identity therefore comes from
 * the OS name, with a counter appended only when two monitors genuinely share
 * one (common with a matched pair).
 */
function assignIds(monitors: readonly Monitor[]): string[] {
  const seen = new Map<string, number>();
  return monitors.map((monitor, index) => {
    const name = monitor.name ?? `Display ${index + 1}`;
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name} (${count + 1})`;
  });
}

function samePosition(a: Monitor, b: Monitor): boolean {
  return a.position.x === b.position.x && a.position.y === b.position.y;
}

function sameLayout(a: readonly DisplayInfo[], b: readonly DisplayInfo[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((display, index) => {
    const other = b[index];
    if (!other) return false;
    return (
      display.id === other.id &&
      display.scaleFactor === other.scaleFactor &&
      sameRect(display.bounds, other.bounds) &&
      sameRect(display.workArea, other.workArea)
    );
  });
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function describe(display: DisplayInfo): string {
  const { x, y, width, height } = display.bounds;
  const primary = display.isPrimary ? ' primary' : '';
  // Logical geometry, since that is the space the companion reasons in.
  return `${display.name} ${width}x${height} @ (${x},${y}) scale ${display.scaleFactor}${primary}`;
}
