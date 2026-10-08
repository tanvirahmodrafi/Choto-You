import { describe, expect, it } from 'vitest';
import { AvatarHandover } from './AvatarHandover';

// A secondary display left of the primary one, so nothing can quietly depend
// on the work area starting at x=0.
const bounds = { x: -1920, y: -200, width: 1920, height: 1080 };
const size = { width: 120, height: 120 };
const left = bounds.x;
const right = bounds.x + bounds.width - size.width;
const ground = bounds.y + bounds.height - size.height;

/** Runs the handover forward in small steps, as the ticker would. */
function run(handover: AvatarHandover, seconds: number, step = 1 / 60): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += step) {
    handover.update(step, bounds, size);
  }
}

/** Walks the whole sequence up to the delivery spot. */
function arrive(handover: AvatarHandover, anchorX: number): void {
  handover.setSpeed(600);
  handover.start(anchorX, bounds, size);
  run(handover, 1);
  handover.avatarReady();
  run(handover, 5);
}

describe('avatar handover', () => {
  it('does nothing until a reminder asks for another avatar', () => {
    const handover = new AvatarHandover();
    run(handover, 5);
    expect(handover.stage).toBe('idle');
    expect(handover.isActive).toBe(false);
  });

  it('runs the roaming character off whichever edge is nearer', () => {
    const handover = new AvatarHandover();
    handover.setSpeed(600);
    handover.start(right - 100, bounds, size);
    expect(handover.side).toBe('right');
    expect(handover.stage).toBe('clearing');

    handover.start(left + 100, bounds, size);
    expect(handover.side).toBe('left');
    run(handover, 0.1);
    expect(handover.position.x).toBeLessThan(left + 100);
    expect(handover.position.y).toBe(ground);
  });

  it('waits off screen for the visiting avatar before showing it', () => {
    const handover = new AvatarHandover();
    handover.setSpeed(600);
    handover.start(left + 300, bounds, size);
    run(handover, 1);

    // Fully beyond the edge, and staying there: the pack has not loaded yet.
    expect(handover.stage).toBe('swapping');
    expect(handover.position.x).toBe(left);
    expect(handover.offset).toBeCloseTo(-1);
    run(handover, 2);
    expect(handover.stage).toBe('swapping');

    handover.avatarReady();
    expect(handover.stage).toBe('peeking');
    run(handover, 0.6);
    // Half out — the look of someone checking the room before stepping in.
    expect(handover.offset).toBeGreaterThan(-1);
    expect(handover.offset).toBeLessThan(-0.4);
  });

  it('gives up waiting rather than leaving the companion off screen', () => {
    const handover = new AvatarHandover();
    handover.setSpeed(600);
    handover.start(left, bounds, size);
    run(handover, 10);
    expect(handover.stage).not.toBe('swapping');
  });

  it('walks in to the corner it came from and holds there for the reminder', () => {
    const handover = new AvatarHandover();
    arrive(handover, left + 300);

    expect(handover.stage).toBe('present');
    expect(handover.isPresenting).toBe(true);
    // The corner it entered at, not the middle of the display.
    expect(handover.position).toEqual({ x: left + 18, y: ground });
    expect(handover.offset).toBe(0);
    expect(handover.facing).toBe('inward');

    run(handover, 60);
    expect(handover.stage).toBe('present');
  });

  it('walks the visitor out, then brings the roaming character home', () => {
    const handover = new AvatarHandover();
    const anchorX = left + 300;
    arrive(handover, anchorX);

    handover.leave();
    expect(handover.stage).toBe('departing');
    expect(handover.facing).toBe('outward');
    run(handover, 2);

    expect(handover.stage).toBe('restoring');
    expect(handover.offset).toBeCloseTo(-1);
    handover.avatarReady();
    expect(handover.stage).toBe('returning');
    expect(handover.facing).toBe('inward');

    run(handover, 2);
    expect(handover.stage).toBe('idle');
    expect(handover.isActive).toBe(false);
    expect(handover.position).toEqual({ x: anchorX, y: ground });
    expect(handover.offset).toBe(0);
  });

  it('skips the walk out when the visitor had not arrived yet', () => {
    const handover = new AvatarHandover();
    handover.setSpeed(600);
    handover.start(left + 300, bounds, size);
    run(handover, 1);
    expect(handover.stage).toBe('swapping');

    // Cancelled while still off screen: there is nothing to walk out of.
    handover.leave();
    expect(handover.stage).toBe('restoring');
  });

  it('never shows an avatar that has not loaded, however long the tick', () => {
    const handover = new AvatarHandover();
    handover.setSpeed(600);
    handover.start(right - 200, bounds, size);
    // A tick far longer than the ticker ever delivers must still not carry the
    // character past the stage that is waiting for the pack.
    handover.update(5, bounds, size);
    expect(handover.stage).toBe('swapping');
    expect(handover.offset).toBeCloseTo(1);
  });

  it('walks the whole sequence through on the right-hand edge too', () => {
    const handover = new AvatarHandover();
    const anchorX = right - 200;
    arrive(handover, anchorX);
    expect(handover.side).toBe('right');
    expect(handover.stage).toBe('present');

    handover.leave();
    run(handover, 2);
    handover.avatarReady();
    run(handover, 2);
    expect(handover.stage).toBe('idle');
    expect(handover.position.x).toBe(anchorX);
  });

  it('comes back on screen when it is abandoned part way through', () => {
    const handover = new AvatarHandover();
    handover.setSpeed(600);
    handover.start(left + 400, bounds, size);
    run(handover, 0.2);
    handover.reset();
    expect(handover.isActive).toBe(false);
    // Whatever the slide had reached, the character is drawn in its window.
    expect(handover.offset).toBe(0);
    expect(handover.position.x).toBeGreaterThanOrEqual(left);
    expect(handover.position.x).toBeLessThanOrEqual(right);
  });

  it('keeps the character inside a work area that shrinks mid-walk', () => {
    const handover = new AvatarHandover();
    arrive(handover, left + 300);
    const narrow = { x: bounds.x, y: bounds.y, width: 400, height: 600 };
    handover.update(1 / 60, narrow, size);
    expect(handover.position.x).toBeLessThanOrEqual(narrow.x + narrow.width - size.width);
    expect(handover.position.y).toBe(narrow.y + narrow.height - size.height);
  });
});
