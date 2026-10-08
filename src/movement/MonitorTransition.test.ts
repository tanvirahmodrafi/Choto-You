import { describe, expect, it, vi } from 'vitest';
import { AnimationPlayer } from '@/animation/AnimationPlayer';
import type { AnimationClip } from '@/animation/types';
import { MonitorTopology } from '@/displays/MonitorTopology';
import type { DisplayInfo } from '@/displays/types';
import { BoundaryDetector } from './BoundaryDetector';
import { MonitorTransition } from './MonitorTransition';
import { MovementEngine } from './MovementEngine';
import type { Rect } from './types';

const SIZE = { width: 100, height: 100 };

function clip(name: string, loop = true): AnimationClip {
  return { name, fps: 10, loop, frames: [`${name}/1.png`, `${name}/2.png`] };
}

const CLIPS = new Map(
  [clip('idle'), clip('walk'), clip('jump', false), clip('fall'), clip('land', false)].map((c) => [
    c.name,
    c,
  ]),
);

function display(id: string, bounds: Rect, isPrimary = false): DisplayInfo {
  return { id, name: id, bounds, workArea: bounds, physicalBounds: bounds, scaleFactor: 1, isPrimary };
}

// The user's arrangement: upper display stacked above the primary one.
const LOWER = display('lower', { x: 0, y: 0, width: 1920, height: 1080 }, true);
const UPPER = display('upper', { x: 0, y: -1080, width: 1920, height: 1080 });

function setup() {
  const boundaries = new BoundaryDetector(LOWER.workArea, SIZE);
  const movement = new MovementEngine(boundaries, { x: 500, y: boundaries.groundY });
  const player = new AnimationPlayer(CLIPS);
  const topology = new MonitorTopology([LOWER, UPPER]);
  const transition = new MonitorTransition(movement, boundaries, player, topology);
  return { boundaries, movement, player, topology, transition };
}

/** Runs the transition and movement forward in small, realistic steps. */
function run(
  transition: MonitorTransition,
  movement: MovementEngine,
  seconds: number,
  step = 1 / 60,
) {
  for (let elapsed = 0; elapsed < seconds; elapsed += step) {
    movement.update(step);
    transition.update(step);
  }
}

describe('MonitorTransition', () => {
  it('refuses a direction with no display in it', () => {
    const { transition } = setup();
    const result = transition.begin('lower', 'left', {
      onEnterDisplay: vi.fn(),
      onComplete: vi.fn(),
    });
    expect(result).toBe(false);
    expect(transition.isActive).toBe(false);
  });

  it('walks to the edge before jumping, rather than teleporting', () => {
    const { transition, movement } = setup();
    transition.begin('lower', 'up', { onEnterDisplay: vi.fn(), onComplete: vi.fn() });

    expect(transition.currentStage).toBe('approaching_edge');
    // Still on the lower display while it walks.
    expect(movement.getSnapshot().position.y).toBe(980);
  });

  it('completes a crossing to the display above and lands on its floor', () => {
    const { transition, movement, boundaries } = setup();
    const onEnterDisplay = vi.fn((display: DisplayInfo) => {
      boundaries.setBounds(display.workArea);
    });
    const onComplete = vi.fn();

    transition.begin('lower', 'up', { onEnterDisplay, onComplete });
    run(transition, movement, 12);

    expect(onEnterDisplay).toHaveBeenCalledWith(UPPER);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(transition.isActive).toBe(false);

    // Standing on the floor of the upper display, which is at negative y.
    expect(movement.getSnapshot().position.y).toBe(-1080 + 1080 - 100);
    expect(movement.getSnapshot().position.y).toBe(-100);
  });

  it('leaves the companion idle after crossing upward, free to wander again', () => {
    const { transition, movement, boundaries } = setup();
    transition.begin('lower', 'up', {
      onEnterDisplay: (display) => boundaries.setBounds(display.workArea),
      onComplete: vi.fn(),
    });
    run(transition, movement, 12);

    // The upward entry point is already on the floor, so the fall ends without
    // ever being airborne; a mode left at 'falling' would freeze the companion
    // on the display it just arrived at.
    expect(movement.getSnapshot().mode).toBe('idle');
    expect(movement.getSnapshot().grounded).toBe(true);
  });

  it('falls onto the display below when crossing downward', () => {
    const boundaries = new BoundaryDetector(UPPER.workArea, SIZE);
    const movement = new MovementEngine(boundaries, { x: 500, y: boundaries.groundY });
    const player = new AnimationPlayer(CLIPS);
    const topology = new MonitorTopology([LOWER, UPPER]);
    const transition = new MonitorTransition(movement, boundaries, player, topology);

    transition.begin('upper', 'down', {
      onEnterDisplay: (display) => boundaries.setBounds(display.workArea),
      onComplete: vi.fn(),
    });
    run(transition, movement, 12);

    expect(movement.getSnapshot().position.y).toBe(980);
    expect(movement.getSnapshot().grounded).toBe(true);
  });

  it('plays the jump and land animations along the way', () => {
    const { transition, movement, player } = setup();
    const seen = new Set<string>();
    const originalPlay = player.play.bind(player);
    vi.spyOn(player, 'play').mockImplementation((name, options) => {
      seen.add(name);
      return originalPlay(name, options);
    });

    transition.begin('lower', 'up', {
      onEnterDisplay: vi.fn(),
      onComplete: vi.fn(),
    });
    run(transition, movement, 12);

    expect(seen).toContain('walk');
    expect(seen).toContain('jump');
    expect(seen).toContain('land');
  });

  it('can be cancelled mid-crossing', () => {
    const { transition, movement } = setup();
    const onComplete = vi.fn();
    transition.begin('lower', 'up', { onEnterDisplay: vi.fn(), onComplete });

    run(transition, movement, 1);
    transition.cancel();

    expect(transition.isActive).toBe(false);
    run(transition, movement, 5);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('enters within the shared edge when the displays only partly overlap', () => {
    const narrow = display('narrow', { x: 1500, y: -1080, width: 800, height: 1080 });
    const boundaries = new BoundaryDetector(LOWER.workArea, SIZE);
    const movement = new MovementEngine(boundaries, { x: 100, y: boundaries.groundY });
    const player = new AnimationPlayer(CLIPS);
    const topology = new MonitorTopology([LOWER, narrow]);
    const transition = new MonitorTransition(movement, boundaries, player, topology);

    transition.begin('lower', 'up', {
      onEnterDisplay: (d) => boundaries.setBounds(d.workArea),
      onComplete: vi.fn(),
    });
    run(transition, movement, 20);

    const { position } = movement.getSnapshot();
    // Must land inside the narrow display, not off its left edge.
    expect(position.x).toBeGreaterThanOrEqual(1500);
    expect(position.x).toBeLessThanOrEqual(2300 - SIZE.width);
  });
});
