import { describe, expect, it } from 'vitest';
import { BoundaryDetector } from './BoundaryDetector';

/** A work area at a negative origin, as a second monitor legitimately has. */
const SECOND_MONITOR = { x: -1920, y: -200, width: 1920, height: 1080 };

describe('BoundaryDetector', () => {
  it('works at a negative origin without assuming a zero-based screen', () => {
    const boundaries = new BoundaryDetector(SECOND_MONITOR, { width: 96, height: 96 });

    expect(boundaries.minX).toBe(-1920);
    expect(boundaries.maxX).toBe(-96);
    expect(boundaries.groundY).toBe(784);
    expect(boundaries.isWithin(boundaries.safePosition())).toBe(true);
  });

  it('reports the edges it is touching', () => {
    const boundaries = new BoundaryDetector(SECOND_MONITOR, { width: 96, height: 96 });

    expect(boundaries.atHorizontalEdge({ x: -1920, y: 0 })).toBe('left');
    expect(boundaries.atHorizontalEdge({ x: -96, y: 0 })).toBe('right');
    expect(boundaries.atHorizontalEdge({ x: -1000, y: 0 })).toBeNull();
  });

  describe('when the companion is larger than the work area', () => {
    // Reachable with a large size setting on a small work area. The range is
    // inverted here — maxX is below minX — which is the case every bound has
    // to survive, because the companion must never become unreachable.
    const boundaries = new BoundaryDetector(
      { x: 0, y: 0, width: 400, height: 300 },
      { width: 600, height: 500 },
    );

    it('has an inverted horizontal range', () => {
      expect(boundaries.minX).toBe(0);
      expect(boundaries.maxX).toBe(-200);
    });

    it('clamps to the top-left of the work area rather than to nonsense', () => {
      expect(boundaries.clampPosition({ x: 50, y: 50 })).toEqual({ x: 0, y: 0 });
      expect(boundaries.clampPosition({ x: -5000, y: 5000 })).toEqual({ x: 0, y: 0 });
    });

    it('returns a safe position that is actually on screen', () => {
      // The midpoint of an inverted range sits outside the work area, which is
      // exactly the situation safePosition() exists to rescue.
      expect(boundaries.safePosition()).toEqual({ x: 0, y: 0 });
      expect(boundaries.isWithin(boundaries.safePosition())).toBe(true);
    });
  });

  it('follows the work area when a display change moves it', () => {
    const boundaries = new BoundaryDetector(
      { x: 0, y: 0, width: 1920, height: 1080 },
      { width: 96, height: 96 },
    );
    boundaries.setBounds(SECOND_MONITOR);

    expect(boundaries.maxX).toBe(-96);
    expect(boundaries.isWithin(boundaries.safePosition())).toBe(true);
  });
});
