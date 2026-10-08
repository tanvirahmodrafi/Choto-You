import { describe, expect, it } from 'vitest';
import type { Rect } from '@/movement/types';
import {
  DEFAULT_BUBBLE_METRICS as M,
  characterOnlyLayout,
  characterRectFor,
  computeLayout,
  windowOriginFor,
} from './OverlayLayout';

const SIZE = { width: 96, height: 96 };
const WORK: Rect = { x: 0, y: 30, width: 2560, height: 1410 };

describe('character-only layout', () => {
  it('makes the window exactly the character, so it blocks as little as possible', () => {
    const layout = characterOnlyLayout(SIZE);
    expect(layout.windowSize).toEqual(SIZE);
    expect(layout.characterOffset).toEqual({ x: 0, y: 0 });
    expect(layout.bubble).toBeNull();
  });

  it('puts the window origin exactly at the character', () => {
    const layout = characterOnlyLayout(SIZE);
    expect(windowOriginFor(layout, { x: 500, y: 1344 }, WORK)).toEqual({ x: 500, y: 1344 });
  });
});

describe('bubble layout', () => {
  it('grows the window to fit the bubble above the character', () => {
    const layout = computeLayout({
      characterSize: SIZE,
      characterPosition: { x: 500, y: 1344 },
      workArea: WORK,
      bubbleVisible: true,
    });

    expect(layout.windowSize.width).toBe(M.width);
    expect(layout.windowSize.height).toBe(M.height + M.gap + SIZE.height);
    expect(layout.characterOffset.y).toBe(M.height + M.gap);
  });

  it('opens to the right when there is room', () => {
    const layout = computeLayout({
      characterSize: SIZE,
      characterPosition: { x: 500, y: 1344 },
      workArea: WORK,
      bubbleVisible: true,
    });

    expect(layout.bubble?.side).toBe('right');
    expect(layout.characterOffset.x).toBe(0);
  });

  it('flips to the left near the right edge of the display', () => {
    const layout = computeLayout({
      characterSize: SIZE,
      characterPosition: { x: WORK.width - SIZE.width, y: 1344 },
      workArea: WORK,
      bubbleVisible: true,
    });

    expect(layout.bubble?.side).toBe('left');
    // The character moves to the right end of the window so the bubble has
    // room on its left.
    expect(layout.characterOffset.x).toBe(M.width - SIZE.width);
  });

  it('keeps the tail pointing at the character after a flip', () => {
    const right = computeLayout({
      characterSize: SIZE,
      characterPosition: { x: 500, y: 1344 },
      workArea: WORK,
      bubbleVisible: true,
    });
    const left = computeLayout({
      characterSize: SIZE,
      characterPosition: { x: WORK.width - SIZE.width, y: 1344 },
      workArea: WORK,
      bubbleVisible: true,
    });

    expect(right.tailX).toBe(SIZE.width / 2);
    expect(left.tailX).toBe(M.width - SIZE.width / 2);
  });
});

describe('keeping the bubble on screen', () => {
  it('pushes the window down when the character is near the top', () => {
    const layout = computeLayout({
      characterSize: SIZE,
      characterPosition: { x: 500, y: WORK.y },
      workArea: WORK,
      bubbleVisible: true,
    });
    const origin = windowOriginFor(layout, { x: 500, y: WORK.y }, WORK);

    // There is no room above the character for the bubble, so the window is
    // clamped into the work area rather than drawn off the top of the screen.
    expect(origin.y).toBe(WORK.y);
  });

  it('pushes the window left when the bubble would overflow the right edge', () => {
    const position = { x: WORK.width - SIZE.width, y: 1344 };
    const layout = computeLayout({
      characterSize: SIZE,
      characterPosition: position,
      workArea: WORK,
      bubbleVisible: true,
    });
    const origin = windowOriginFor(layout, position, WORK);

    expect(origin.x + layout.windowSize.width).toBeLessThanOrEqual(WORK.x + WORK.width);
  });

  it('reports where the character ended up after the window was clamped', () => {
    const position = { x: 500, y: WORK.y };
    const layout = computeLayout({
      characterSize: SIZE,
      characterPosition: position,
      workArea: WORK,
      bubbleVisible: true,
    });
    const origin = windowOriginFor(layout, position, WORK);
    const rect = characterRectFor(layout, origin, SIZE);

    // Clicks must follow the character, not the position it asked for.
    expect(rect.y).toBe(origin.y + layout.characterOffset.y);
    expect(rect.width).toBe(SIZE.width);
  });

  it('works on a display at negative coordinates', () => {
    const upper: Rect = { x: 0, y: -1080, width: 1920, height: 1080 };
    const position = { x: 100, y: -200 };
    const layout = computeLayout({
      characterSize: SIZE,
      characterPosition: position,
      workArea: upper,
      bubbleVisible: true,
    });
    const origin = windowOriginFor(layout, position, upper);

    expect(origin.y).toBeGreaterThanOrEqual(upper.y);
    expect(origin.y + layout.windowSize.height).toBeLessThanOrEqual(upper.y + upper.height);
  });
});
