import { describe, expect, it } from 'vitest';
import type { Rect } from '@/movement/types';
import { ActiveMonitorDetector } from './ActiveMonitorDetector';
import type { DisplayManager } from './DisplayManager';
import type { DisplayInfo } from './types';

function display(id: string, bounds: Rect, isPrimary = false): DisplayInfo {
  return { id, name: id, bounds, workArea: bounds, physicalBounds: bounds, scaleFactor: 1, isPrimary };
}

const LEFT = display('left', { x: 0, y: 0, width: 1920, height: 1080 }, true);
const RIGHT = display('right', { x: 1920, y: 0, width: 1920, height: 1080 });

function makeDetector() {
  const displays = {
    displayContaining: (point: { x: number; y: number }) =>
      [LEFT, RIGHT].find(
        (d) =>
          point.x >= d.bounds.x &&
          point.x < d.bounds.x + d.bounds.width &&
          point.y >= d.bounds.y &&
          point.y < d.bounds.y + d.bounds.height,
      ) ?? null,
  } as unknown as DisplayManager;
  return new ActiveMonitorDetector(displays);
}

describe('ActiveMonitorDetector', () => {
  it('stays put while the cursor is on the display it already occupies', () => {
    const detector = makeDetector();
    expect(detector.update(10, { x: 500, y: 500 }, LEFT)).toBeNull();
  });

  it('does nothing without a cursor position', () => {
    const detector = makeDetector();
    expect(detector.update(10, null, LEFT)).toBeNull();
  });

  it('waits before following the cursor to another display', () => {
    const detector = makeDetector();
    const onRight = { x: 2500, y: 500 };

    // Deliberately slow: chasing the pointer the instant it crosses would
    // make the companion teleport constantly.
    expect(detector.update(1, onRight, LEFT)).toBeNull();
    expect(detector.update(1, onRight, LEFT)).toBeNull();
    expect(detector.update(1.5, onRight, LEFT)?.id).toBe('right');
  });

  it('cancels the switch if the cursor comes back', () => {
    const detector = makeDetector();
    detector.update(2, { x: 2500, y: 500 }, LEFT);
    detector.update(1, { x: 500, y: 500 }, LEFT); // back home

    // The earlier dwell time must not carry over.
    expect(detector.update(2, { x: 2500, y: 500 }, LEFT)).toBeNull();
  });

  it('restarts the timer when the cursor moves to a third display', () => {
    const third = display('third', { x: 3840, y: 0, width: 1920, height: 1080 });
    const displays = {
      displayContaining: (point: { x: number; y: number }) =>
        [LEFT, RIGHT, third].find(
          (d) => point.x >= d.bounds.x && point.x < d.bounds.x + d.bounds.width,
        ) ?? null,
    } as unknown as DisplayManager;
    const detector = new ActiveMonitorDetector(displays);

    detector.update(2.5, { x: 2500, y: 500 }, LEFT);
    expect(detector.update(1, { x: 4500, y: 500 }, LEFT)).toBeNull();
    expect(detector.update(3.5, { x: 4500, y: 500 }, LEFT)?.id).toBe('third');
  });

  it('only reports a switch once', () => {
    const detector = makeDetector();
    const onRight = { x: 2500, y: 500 };
    detector.update(4, onRight, LEFT);
    // Now on the right display; nothing further to do.
    expect(detector.update(4, onRight, RIGHT)).toBeNull();
  });

  it('can be reset, e.g. when the display mode changes', () => {
    const detector = makeDetector();
    detector.update(2.5, { x: 2500, y: 500 }, LEFT);
    detector.reset();
    expect(detector.update(1, { x: 2500, y: 500 }, LEFT)).toBeNull();
  });

  it('ignores a cursor that is on no display at all', () => {
    const detector = makeDetector();
    expect(detector.update(10, { x: 99999, y: 99999 }, LEFT)).toBeNull();
  });
});
