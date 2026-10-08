import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Rect } from '@/movement/types';
import { InteractionController } from './InteractionController';
import { DEFAULT_INTERACTION_CONFIG } from './types';

const HITBOX: Rect = { x: 100, y: 100, width: 100, height: 100 };

function setup(overrides: Partial<typeof DEFAULT_INTERACTION_CONFIG> = {}) {
  const events = {
    onClick: vi.fn(),
    onDoubleClick: vi.fn(),
    onRightClick: vi.fn(),
    onDragStart: vi.fn(),
    onDrag: vi.fn(),
    onDragEnd: vi.fn(),
    onProximityChange: vi.fn(),
    onCursorMoved: vi.fn(),
  };
  const setClickThrough = vi.fn();
  const controller = new InteractionController(
    { getHitbox: () => HITBOX, setClickThrough, events },
    { ...DEFAULT_INTERACTION_CONFIG, ...overrides },
  );
  return { controller, events, setClickThrough };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('click-through', () => {
  it('starts click-through so the desktop stays usable', () => {
    const { controller, setClickThrough } = setup();
    controller.start();
    expect(setClickThrough).toHaveBeenCalledWith(true);
    controller.stop();
  });

  it('becomes solid only while the cursor is over the character', () => {
    const { controller, setClickThrough } = setup();
    controller.start();
    setClickThrough.mockClear();

    controller.updateCursor({ x: 150, y: 150 }); // on the character
    expect(setClickThrough).toHaveBeenLastCalledWith(false);

    controller.updateCursor({ x: 150, y: 400 }); // off it again
    expect(setClickThrough).toHaveBeenLastCalledWith(true);
    controller.stop();
  });

  it('does not toggle repeatedly while the cursor stays put', () => {
    const { controller, setClickThrough } = setup();
    controller.start();
    controller.updateCursor({ x: 150, y: 150 });
    setClickThrough.mockClear();

    controller.updateCursor({ x: 151, y: 151 });
    controller.updateCursor({ x: 152, y: 152 });
    // Each call crosses the IPC boundary, so redundant ones must be skipped.
    expect(setClickThrough).not.toHaveBeenCalled();
    controller.stop();
  });

  it('stays click-through entirely when interaction is disabled', () => {
    const { controller, setClickThrough } = setup({ enabled: false });
    controller.start();
    setClickThrough.mockClear();

    controller.updateCursor({ x: 150, y: 150 });
    expect(setClickThrough).not.toHaveBeenCalled();
    controller.stop();
  });
});

describe('clicks', () => {
  it('reports a single click after the double-click window passes', () => {
    const { controller, events } = setup();
    controller.handlePointerUp(false);

    expect(events.onClick).not.toHaveBeenCalled(); // still waiting
    vi.advanceTimersByTime(DEFAULT_INTERACTION_CONFIG.doubleClickMs + 1);
    expect(events.onClick).toHaveBeenCalledTimes(1);
  });

  it('reports a double click and suppresses the single click', () => {
    const { controller, events } = setup();
    controller.handlePointerUp(false);
    vi.advanceTimersByTime(50);
    controller.handlePointerUp(false);

    expect(events.onDoubleClick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    // Firing both would play two reactions on top of each other.
    expect(events.onClick).not.toHaveBeenCalled();
  });

  it('treats two slow clicks as two single clicks', () => {
    const { controller, events } = setup();
    controller.handlePointerUp(false);
    vi.advanceTimersByTime(DEFAULT_INTERACTION_CONFIG.doubleClickMs + 10);
    controller.handlePointerUp(false);
    vi.advanceTimersByTime(DEFAULT_INTERACTION_CONFIG.doubleClickMs + 10);

    expect(events.onClick).toHaveBeenCalledTimes(2);
    expect(events.onDoubleClick).not.toHaveBeenCalled();
  });

  it('does not treat the end of a drag as a click', () => {
    const { controller, events } = setup();
    controller.handlePointerDown(0, { x: 150, y: 150 }, { x: 100, y: 100 });
    controller.handlePointerUp(true); // the pointer moved

    vi.advanceTimersByTime(1000);
    expect(events.onClick).not.toHaveBeenCalled();
    expect(events.onDragEnd).toHaveBeenCalledTimes(1);
  });

  it('reports a right click without starting a drag', () => {
    const { controller, events } = setup();
    controller.handlePointerDown(2, { x: 150, y: 150 }, { x: 100, y: 100 });

    expect(events.onRightClick).toHaveBeenCalledTimes(1);
    expect(events.onDragStart).not.toHaveBeenCalled();
  });
});

describe('dragging', () => {
  it('keeps the grab offset so the character does not snap to the cursor', () => {
    const { controller, events } = setup();
    // Grabbed 50px right and 50px down from the window's top-left corner.
    controller.handlePointerDown(0, { x: 150, y: 150 }, { x: 100, y: 100 });
    controller.updateCursor({ x: 600, y: 400 });

    expect(events.onDrag).toHaveBeenLastCalledWith({ x: 550, y: 350 });
  });

  it('does not run hover logic while dragging', () => {
    const { controller, setClickThrough } = setup();
    controller.start();
    controller.handlePointerDown(0, { x: 150, y: 150 }, { x: 100, y: 100 });
    setClickThrough.mockClear();

    controller.updateCursor({ x: 5000, y: 5000 });
    // Going click-through mid-drag would drop the drag.
    expect(setClickThrough).not.toHaveBeenCalled();
    controller.stop();
  });

  it('ignores drags when dragging is turned off', () => {
    const { controller, events } = setup({ draggable: false });
    controller.handlePointerDown(0, { x: 150, y: 150 }, { x: 100, y: 100 });
    expect(events.onDragStart).not.toHaveBeenCalled();
    expect(controller.isDragging).toBe(false);
  });
});

describe('proximity', () => {
  it('reports when the cursor comes near and when it leaves', () => {
    const { controller, events } = setup({ proximityRadius: 50 });
    controller.start();

    controller.updateCursor({ x: 170, y: 130 }); // inside the hitbox
    expect(events.onProximityChange).toHaveBeenLastCalledWith(true, { x: 170, y: 130 });

    controller.updateCursor({ x: 1000, y: 1000 });
    expect(events.onProximityChange).toHaveBeenLastCalledWith(false, null);
    controller.stop();
  });

  it('stays quiet when cursor tracking is off', () => {
    const { controller, events } = setup({ trackCursor: false });
    controller.start();
    controller.updateCursor({ x: 150, y: 150 });
    expect(events.onProximityChange).not.toHaveBeenCalled();
    controller.stop();
  });
});
