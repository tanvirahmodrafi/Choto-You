import { describe, expect, it, vi } from 'vitest';
import { BoundaryDetector } from './BoundaryDetector';
import { DEFAULT_MOVEMENT_CONFIG, MovementEngine } from './MovementEngine';
import type { Rect } from './types';

const SIZE = { width: 100, height: 100 };

function makeEngine(bounds: Rect, startX = 500, startY?: number) {
  const boundaries = new BoundaryDetector(bounds, SIZE);
  const engine = new MovementEngine(boundaries, {
    x: startX,
    y: startY ?? boundaries.groundY,
  });
  return { engine, boundaries };
}

describe('BoundaryDetector', () => {
  it('computes the usable range from the work area and companion size', () => {
    const b = new BoundaryDetector({ x: 0, y: 0, width: 1920, height: 1080 }, SIZE);
    expect(b.minX).toBe(0);
    expect(b.maxX).toBe(1820);
    expect(b.groundY).toBe(980);
  });

  it('handles a monitor at negative coordinates', () => {
    // A display stacked above the primary one legitimately has negative y.
    const b = new BoundaryDetector({ x: 0, y: -1080, width: 1920, height: 1080 }, SIZE);
    expect(b.minY).toBe(-1080);
    expect(b.groundY).toBe(-100);
    expect(b.clampPosition({ x: 0, y: -5000 })).toEqual({ x: 0, y: -1080 });
  });

  it('does not produce nonsense when the companion is larger than the work area', () => {
    const b = new BoundaryDetector({ x: 0, y: 0, width: 50, height: 50 }, SIZE);
    // maxX would be negative; clamping must still return something on-screen.
    expect(b.clampPosition({ x: 999, y: 999 })).toEqual({ x: 0, y: 0 });
  });

  it('reports which horizontal edge is being touched', () => {
    const b = new BoundaryDetector({ x: 0, y: 0, width: 1920, height: 1080 }, SIZE);
    expect(b.atHorizontalEdge({ x: 0, y: 980 })).toBe('left');
    expect(b.atHorizontalEdge({ x: 1820, y: 980 })).toBe('right');
    expect(b.atHorizontalEdge({ x: 900, y: 980 })).toBeNull();
  });
});

describe('MovementEngine', () => {
  const bounds: Rect = { x: 0, y: 0, width: 1920, height: 1080 };

  it('moves at a constant speed regardless of how the delta is chopped up', () => {
    const a = makeEngine(bounds, 0).engine;
    const b = makeEngine(bounds, 0).engine;

    a.walkTo(1000);
    b.walkTo(1000);

    a.update(1);
    for (let i = 0; i < 100; i++) b.update(0.01);

    expect(a.getSnapshot().position.x).toBeCloseTo(b.getSnapshot().position.x, 5);
    expect(a.getSnapshot().position.x).toBeCloseTo(DEFAULT_MOVEMENT_CONFIG.walkSpeed, 5);
  });

  it('faces the direction it is walking', () => {
    const { engine } = makeEngine(bounds, 500);
    engine.walkTo(100);
    expect(engine.getSnapshot().direction).toBe('left');
    engine.walkTo(900);
    expect(engine.getSnapshot().direction).toBe('right');
  });

  it('arrives exactly on target without overshooting', () => {
    const { engine } = makeEngine(bounds, 0);
    const onArrive = vi.fn();
    engine.walkTo(10, onArrive);

    engine.update(1); // would travel 120px, far past the target
    expect(engine.getSnapshot().position.x).toBe(10);
    expect(engine.getSnapshot().mode).toBe('idle');
    expect(onArrive).toHaveBeenCalledTimes(1);
  });

  it('clamps a walk target into the usable area', () => {
    const { engine } = makeEngine(bounds, 0);
    engine.walkTo(99999);
    engine.update(100);
    expect(engine.getSnapshot().position.x).toBe(1820);
  });

  it('falls to the ground under gravity and settles', () => {
    const { engine } = makeEngine(bounds, 500, 0);
    engine.release();
    expect(engine.getSnapshot().mode).toBe('falling');

    for (let i = 0; i < 200; i++) engine.update(0.016);

    expect(engine.getSnapshot().position.y).toBe(980);
    expect(engine.getSnapshot().grounded).toBe(true);
    expect(engine.getSnapshot().mode).toBe('idle');
  });

  it('does not move while held', () => {
    const { engine } = makeEngine(bounds, 500, 0);
    engine.hold();
    engine.update(1);
    expect(engine.getSnapshot().position.y).toBe(0);
  });

  it('repositions when the work area shrinks out from under it', () => {
    const { engine } = makeEngine(bounds, 1800);
    // Simulates a monitor being disconnected and a smaller one taking over.
    engine.onBoundsChanged({ x: 0, y: 0, width: 800, height: 600 });

    const { position } = engine.getSnapshot();
    expect(position.x).toBeLessThanOrEqual(700);
    expect(position.y).toBeLessThanOrEqual(500);
  });

  it('survives a work area at negative coordinates', () => {
    const upper: Rect = { x: 0, y: -1080, width: 1920, height: 1080 };
    const { engine } = makeEngine(upper, 500);
    engine.walkTo(900);
    engine.update(1);

    const { position } = engine.getSnapshot();
    expect(position.y).toBe(-100);
    expect(position.x).toBeCloseTo(620, 5);
  });

  it('does not freeze when a walk is cancelled by a layout change', () => {
    // Regression: `revalidate` cleared the walk target but left the mode at
    // 'walking', so the engine never moved and never completed — the companion
    // froze permanently the first time a monitor was plugged in mid-walk.
    const { engine } = makeEngine(bounds, 1800);
    const settled = vi.fn();
    engine.walkTo(100, settled);

    engine.onBoundsChanged({ x: 0, y: 0, width: 800, height: 600 });

    expect(settled).toHaveBeenCalledWith('cancelled');
    expect(engine.getSnapshot().mode).toBe('idle');

    // And it can walk again afterwards.
    engine.walkTo(200);
    engine.update(0.5);
    expect(engine.getSnapshot().mode).toBe('walking');
  });

  it('settles a walk exactly once, with a reason', () => {
    const { engine } = makeEngine(bounds, 0);
    const settled = vi.fn();
    engine.walkTo(10, settled);
    engine.update(1);

    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith('arrived');

    engine.update(1);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('settles the previous walk as cancelled when a new one replaces it', () => {
    const { engine } = makeEngine(bounds, 0);
    const first = vi.fn();
    engine.walkTo(1000, first);
    engine.walkTo(200);

    expect(first).toHaveBeenCalledWith('cancelled');
  });

  it('settles the walk when it is placed directly on another display', () => {
    // Regression: moving the companion to a different display (or restoring a
    // saved position) placed it with `setPosition`, which left the pending
    // settle callback dangling. The wander behaviour went on believing it was
    // still walking and never picked another destination, so the companion
    // stood in one spot indefinitely while "roam freely" was on.
    const { engine } = makeEngine(bounds, 0);
    const settled = vi.fn();
    engine.walkTo(1000, settled);

    engine.setPosition({ x: 400, y: 0 }, 'idle');

    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith('cancelled');
    expect(engine.getSnapshot().mode).toBe('idle');

    // The walk must not resume towards the abandoned target.
    engine.update(1);
    expect(engine.getSnapshot().position.x).toBe(400);
  });

  it('cancels the walk when the companion is grabbed', () => {
    const { engine } = makeEngine(bounds, 0);
    const settled = vi.fn();
    engine.walkTo(1000, settled);
    engine.hold();

    expect(settled).toHaveBeenCalledWith('cancelled');
    expect(engine.getSnapshot().mode).toBe('held');
  });

  it('notifies subscribers as it moves', () => {
    const { engine } = makeEngine(bounds, 0);
    const listener = vi.fn();
    engine.subscribe(listener);
    engine.walkTo(500);
    engine.update(0.1);
    expect(listener).toHaveBeenCalled();
  });

  it('does not notify when nothing moved', () => {
    const { engine } = makeEngine(bounds, 500);
    const listener = vi.fn();
    engine.subscribe(listener);
    engine.update(0.1); // idle and grounded: nothing should change
    expect(listener).not.toHaveBeenCalled();
  });
});
