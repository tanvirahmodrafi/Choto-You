import { describe, expect, it } from 'vitest';
import { MonitorTopology } from './MonitorTopology';
import { squaredDistanceToRect, type DisplayInfo } from './types';
import type { Rect } from '@/movement/types';

function display(id: string, bounds: Rect, scaleFactor = 1, isPrimary = false): DisplayInfo {
  return { id, name: id, bounds, workArea: bounds, physicalBounds: bounds, scaleFactor, isPrimary };
}

/**
 * The user's actual arrangement: two displays stacked vertically, the upper one
 * at negative y. This is the layout the companion must get right.
 */
const LOWER = display('lower', { x: 0, y: 0, width: 1920, height: 1080 }, 1, true);
const UPPER = display('upper', { x: 0, y: -1080, width: 1920, height: 1080 });

describe('MonitorTopology — vertical stack', () => {
  const topology = new MonitorTopology([LOWER, UPPER]);

  it('sees the upper display as reachable by going up', () => {
    const link = topology.linkIn('lower', 'up', 960);
    expect(link).not.toBeNull();
    expect(link?.to).toBe('upper');
    expect(link?.touching).toBe(true);
  });

  it('sees the lower display as reachable by going down', () => {
    const link = topology.linkIn('upper', 'down', 960);
    expect(link?.to).toBe('lower');
  });

  it('reports the shared edge span across the full width', () => {
    const link = topology.linkIn('lower', 'up', 960);
    expect(link?.overlapStart).toBe(0);
    expect(link?.overlapEnd).toBe(1920);
  });

  it('has no left or right neighbour', () => {
    expect(topology.linkIn('lower', 'left', 500)).toBeNull();
    expect(topology.linkIn('lower', 'right', 500)).toBeNull();
  });
});

describe('MonitorTopology — horizontal pair', () => {
  const left = display('left', { x: 0, y: 0, width: 1920, height: 1080 }, 1, true);
  const right = display('right', { x: 1920, y: 0, width: 1920, height: 1080 });
  const topology = new MonitorTopology([left, right]);

  it('links left to right and back', () => {
    expect(topology.linkIn('left', 'right', 500)?.to).toBe('right');
    expect(topology.linkIn('right', 'left', 500)?.to).toBe('left');
  });

  it('has no vertical neighbour', () => {
    expect(topology.linkIn('left', 'up', 500)).toBeNull();
    expect(topology.linkIn('left', 'down', 500)).toBeNull();
  });
});

describe('MonitorTopology — mixed resolutions and partial overlap', () => {
  // A 2560x1440 display above a 1920x1080 one, centred over it, so the shared
  // edge covers only part of the upper display's width.
  const lower = display('lower', { x: 0, y: 0, width: 1920, height: 1080 }, 1, true);
  const upper = display('upper', { x: -320, y: -1440, width: 2560, height: 1440 }, 2);
  const topology = new MonitorTopology([lower, upper]);

  it('restricts the crossing span to the shared range', () => {
    const link = topology.linkIn('lower', 'up', 960);
    expect(link?.to).toBe('upper');
    expect(link?.overlapStart).toBe(0);
    expect(link?.overlapEnd).toBe(1920);
  });

  it('clamps a crossing point into the shared span', () => {
    const link = topology.linkIn('upper', 'down', -300);
    expect(link).not.toBeNull();
    // Walking off the far left of the wide upper display must still land on
    // the narrower display below, not in empty space.
    expect(topology.crossingPoint(link!, -300)).toBe(0);
    expect(topology.crossingPoint(link!, 5000)).toBe(1920);
  });

  it('tolerates displays of different scale factors', () => {
    expect(topology.byId('upper')?.scaleFactor).toBe(2);
    expect(topology.byId('lower')?.scaleFactor).toBe(1);
  });
});

describe('MonitorTopology — imperfect arrangements', () => {
  it('treats a 1px gap as touching', () => {
    const lower = display('lower', { x: 0, y: 0, width: 1920, height: 1080 });
    const upper = display('upper', { x: 0, y: -1081, width: 1920, height: 1080 });
    const topology = new MonitorTopology([lower, upper]);
    expect(topology.linkIn('lower', 'up', 960)?.touching).toBe(true);
  });

  it('still links displays that are far apart, so neither is a dead end', () => {
    const a = display('a', { x: 0, y: 0, width: 1920, height: 1080 });
    const b = display('b', { x: 4000, y: 2000, width: 1920, height: 1080 });
    const topology = new MonitorTopology([a, b]);

    expect(topology.linksFrom('a')).toHaveLength(1);
    expect(topology.linksFrom('a')[0]?.touching).toBe(false);
    expect(topology.linksFrom('b')).toHaveLength(1);
  });

  it('picks the neighbour actually in front when two share an edge', () => {
    // Two 960-wide displays sitting above one 1920-wide display.
    const bottom = display('bottom', { x: 0, y: 0, width: 1920, height: 1080 });
    const topLeft = display('topLeft', { x: 0, y: -1080, width: 960, height: 1080 });
    const topRight = display('topRight', { x: 960, y: -1080, width: 960, height: 1080 });
    const topology = new MonitorTopology([bottom, topLeft, topRight]);

    expect(topology.linkIn('bottom', 'up', 200)?.to).toBe('topLeft');
    expect(topology.linkIn('bottom', 'up', 1500)?.to).toBe('topRight');
  });

  it('handles a single display with no neighbours at all', () => {
    const only = display('only', { x: 0, y: 0, width: 1920, height: 1080 }, 1, true);
    const topology = new MonitorTopology([only]);
    expect(topology.allLinks).toHaveLength(0);
    expect(topology.linkIn('only', 'up', 500)).toBeNull();
  });

  it('handles displays at entirely negative coordinates', () => {
    const a = display('a', { x: -3840, y: -2160, width: 1920, height: 1080 });
    const b = display('b', { x: -1920, y: -2160, width: 1920, height: 1080 });
    const topology = new MonitorTopology([a, b]);
    expect(topology.linkIn('a', 'right', -2000)?.to).toBe('b');
  });
});

describe('squaredDistanceToRect', () => {
  it('is zero inside the rectangle', () => {
    expect(squaredDistanceToRect({ x: 0, y: 0, width: 100, height: 100 }, { x: 50, y: 50 })).toBe(0);
  });

  it('measures to the nearest edge, including from negative coordinates', () => {
    const rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(squaredDistanceToRect(rect, { x: -3, y: 50 })).toBe(9);
    expect(squaredDistanceToRect(rect, { x: -3, y: -4 })).toBe(25);
  });
});
