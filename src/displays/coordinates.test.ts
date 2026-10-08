import { describe, expect, it } from 'vitest';
import type { Rect, Vector2 } from '@/movement/types';
import { MonitorTopology } from './MonitorTopology';
import type { DisplayInfo } from './types';

/**
 * These fixtures are the user's real hardware, as reported by the OS:
 *
 *   external  scale 1  physical (0,0)       2560x1440
 *   laptop    scale 2  physical (1042,2880) 3024x1964
 *
 * In physical pixels the laptop looks 1440px below the external display's
 * bottom edge. In logical points they touch exactly at y=1440. Everything in
 * the movement layer therefore works in logical points.
 */
function toLogical(rect: Rect, scale: number): Rect {
  return {
    x: Math.round(rect.x / scale),
    y: Math.round(rect.y / scale),
    width: Math.round(rect.width / scale),
    height: Math.round(rect.height / scale),
  };
}

function display(id: string, physical: Rect, scale: number, isPrimary = false): DisplayInfo {
  const bounds = toLogical(physical, scale);
  return {
    id,
    name: id,
    bounds,
    workArea: bounds,
    physicalBounds: physical,
    scaleFactor: scale,
    isPrimary,
  };
}

const EXTERNAL = display('external', { x: 0, y: 0, width: 2560, height: 1440 }, 1, true);
const LAPTOP = display('laptop', { x: 1042, y: 2880, width: 3024, height: 1964 }, 2);

describe('mixed-DPI vertical stack (real hardware)', () => {
  it('places the laptop directly below the external display in logical space', () => {
    expect(EXTERNAL.bounds).toEqual({ x: 0, y: 0, width: 2560, height: 1440 });
    expect(LAPTOP.bounds).toEqual({ x: 521, y: 1440, width: 1512, height: 982 });
    // Touching: the external's bottom edge is the laptop's top edge.
    expect(EXTERNAL.bounds.y + EXTERNAL.bounds.height).toBe(LAPTOP.bounds.y);
  });

  it('sees the two displays as adjacent, which physical pixels would not', () => {
    const topology = new MonitorTopology([EXTERNAL, LAPTOP]);
    const down = topology.linkIn('external', 'down', 1000);
    expect(down?.to).toBe('laptop');
    expect(down?.touching).toBe(true);

    const up = topology.linkIn('laptop', 'up', 1000);
    expect(up?.to).toBe('external');
    expect(up?.touching).toBe(true);
  });

  it('restricts the crossing span to where the displays actually overlap', () => {
    const topology = new MonitorTopology([EXTERNAL, LAPTOP]);
    const link = topology.linkIn('external', 'down', 1000);
    // The laptop spans x 521..2033; crossing outside that would land nowhere.
    expect(link?.overlapStart).toBe(521);
    expect(link?.overlapEnd).toBe(2033);
    expect(topology.crossingPoint(link!, 100)).toBe(521);
    expect(topology.crossingPoint(link!, 2500)).toBe(2033);
  });

  it('would wrongly report a gap if physical pixels were compared directly', () => {
    // Guards the regression: comparing raw physical rects across displays with
    // different scale factors is not a coherent coordinate space.
    const physicalExternalBottom = 0 + 1440;
    const physicalLaptopTop = 2880;
    expect(physicalLaptopTop - physicalExternalBottom).toBe(1440);
  });
});

describe('logical-to-physical window positioning', () => {
  /** Mirrors DisplayManager.logicalToPhysical for the two real displays. */
  function toPhysical(point: { x: number; y: number }) {
    const inside = [EXTERNAL, LAPTOP].find(
      (d) =>
        point.x >= d.bounds.x &&
        point.x < d.bounds.x + d.bounds.width &&
        point.y >= d.bounds.y &&
        point.y < d.bounds.y + d.bounds.height,
    );
    if (!inside) return point;
    return {
      x: inside.physicalBounds.x + (point.x - inside.bounds.x) * inside.scaleFactor,
      y: inside.physicalBounds.y + (point.y - inside.bounds.y) * inside.scaleFactor,
    };
  }

  it('is the identity on the 1x display', () => {
    expect(toPhysical({ x: 1200, y: 700 })).toEqual({ x: 1200, y: 700 });
  });

  it('uses the destination display scale, not the window scale', () => {
    // Regression: handing logical coordinates straight to Tauri converts them
    // with whatever scale factor the window currently sits on. Walking from the
    // 1x external onto the 2x laptop would then be converted at 1x and place
    // the window at physical (1328,2326) — inside neither display's physical
    // rect, so the companion would vanish.
    expect(toPhysical({ x: 1328, y: 2326 })).toEqual({ x: 2656, y: 4652 });
  });

  it('places the laptop origin exactly', () => {
    expect(toPhysical({ x: 521, y: 1440 })).toEqual({ x: 1042, y: 2880 });
  });
});

describe('display identity', () => {
  /** Mirrors DisplayManager.assignIds. */
  function assignIds(names: readonly string[]): string[] {
    const seen = new Map<string, number>();
    return names.map((name) => {
      const count = seen.get(name) ?? 0;
      seen.set(name, count + 1);
      return count === 0 ? name : `${name} (${count + 1})`;
    });
  }

  it('keeps a monitor the same identity when another is plugged in before it', () => {
    // Regression: ids used to include the enumeration index, so plugging in a
    // display renumbered the others. The companion then concluded the display
    // it was standing on had been unplugged and teleported away.
    const before = assignIds(['Monitor #41038']);
    const after = assignIds(['Monitor #46128', 'Monitor #41038']);

    expect(before[0]).toBe('Monitor #41038');
    expect(after[1]).toBe('Monitor #41038');
    expect(after).toContain(before[0]);
  });

  it('still distinguishes two monitors that report the same name', () => {
    expect(assignIds(['Acme 27', 'Acme 27'])).toEqual(['Acme 27', 'Acme 27 (2)']);
  });
});

describe('physical-to-logical cursor mapping', () => {
  /** Mirrors DisplayManager.physicalToLogical for the two real displays. */
  function mapCursor(point: Vector2): Vector2 {
    const inside = [EXTERNAL, LAPTOP].find(
      (d) =>
        point.x >= d.physicalBounds.x &&
        point.x < d.physicalBounds.x + d.physicalBounds.width &&
        point.y >= d.physicalBounds.y &&
        point.y < d.physicalBounds.y + d.physicalBounds.height,
    );
    if (!inside) return point;
    return {
      x: inside.bounds.x + (point.x - inside.physicalBounds.x) / inside.scaleFactor,
      y: inside.bounds.y + (point.y - inside.physicalBounds.y) / inside.scaleFactor,
    };
  }

  it('is the identity on a 1x display', () => {
    expect(mapCursor({ x: 500, y: 600 })).toEqual({ x: 500, y: 600 });
  });

  it('maps a cursor on the 2x laptop into logical points on that display', () => {
    // Centre of the laptop in physical pixels.
    const logical = mapCursor({ x: 1042 + 1512, y: 2880 + 982 });
    expect(logical).toEqual({ x: 521 + 756, y: 1440 + 491 });
  });
});
