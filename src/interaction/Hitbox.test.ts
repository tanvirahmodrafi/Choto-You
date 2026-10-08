import { describe, expect, it } from 'vitest';
import { directionToward, distanceToRect, hitboxRect, pointInRect } from './Hitbox';

const HITBOX = { x: 0.25, y: 0.2, width: 0.5, height: 0.7 };
const SIZE = { width: 200, height: 200 };

describe('hitboxRect', () => {
  it('maps the normalised hitbox onto the window position', () => {
    expect(hitboxRect({ x: 1000, y: 500 }, SIZE, HITBOX)).toEqual({
      x: 1050,
      y: 540,
      width: 100,
      height: 140,
    });
  });

  it('works at negative coordinates, for a display above the primary one', () => {
    expect(hitboxRect({ x: -400, y: -1080 }, SIZE, HITBOX)).toEqual({
      x: -350,
      y: -1040,
      width: 100,
      height: 140,
    });
  });
});

describe('pointInRect', () => {
  const rect = hitboxRect({ x: 0, y: 0 }, SIZE, HITBOX);

  it('accepts a point on the character', () => {
    expect(pointInRect(rect, { x: 100, y: 100 })).toBe(true);
  });

  it('rejects the transparent padding around the character', () => {
    // Inside the 200x200 window, but outside the character itself: this click
    // must reach whatever is behind the overlay.
    expect(pointInRect(rect, { x: 10, y: 10 })).toBe(false);
    expect(pointInRect(rect, { x: 190, y: 190 })).toBe(false);
  });
});

describe('distanceToRect', () => {
  const rect = { x: 100, y: 100, width: 100, height: 100 };

  it('is zero inside', () => {
    expect(distanceToRect(rect, { x: 150, y: 150 })).toBe(0);
  });

  it('measures to the nearest edge', () => {
    expect(distanceToRect(rect, { x: 80, y: 150 })).toBe(20);
    expect(distanceToRect(rect, { x: 100 - 3, y: 100 - 4 })).toBe(5);
  });
});

describe('directionToward', () => {
  const rect = { x: 100, y: 100, width: 100, height: 100 };

  it('faces the cursor', () => {
    expect(directionToward(rect, { x: 0, y: 150 })).toBe('left');
    expect(directionToward(rect, { x: 500, y: 150 })).toBe('right');
  });
});
