import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ticker } from './Ticker';

/**
 * A controllable requestAnimationFrame, so loop behaviour can be tested
 * without real frames or real time.
 */
function installFakeRaf() {
  let now = 0;
  let pending: ((timestamp: number) => void) | null = null;

  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    pending = callback;
    return 1;
  }) as typeof globalThis.requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {
    pending = null;
  }) as typeof globalThis.cancelAnimationFrame;
  globalThis.performance = { now: () => now } as Performance;

  return {
    /** Delivers one frame, advancing the clock by `ms`. */
    frame(ms: number) {
      now += ms;
      const callback = pending;
      pending = null;
      callback?.(now);
    },
    get isScheduled() {
      return pending !== null;
    },
  };
}

let raf: ReturnType<typeof installFakeRaf>;

beforeEach(() => {
  raf = installFakeRaf();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Ticker', () => {
  it('does not run until something subscribes', () => {
    const ticker = new Ticker();
    expect(ticker.isRunning).toBe(false);
  });

  it('delivers deltas in seconds', () => {
    const ticker = new Ticker();
    const listener = vi.fn();
    ticker.subscribe(listener);

    raf.frame(16);
    expect(listener).toHaveBeenCalledWith(expect.closeTo(0.016, 5));
  });

  it('stops once the last subscriber leaves', () => {
    const ticker = new Ticker();
    const stop = ticker.subscribe(vi.fn());
    expect(ticker.isRunning).toBe(true);

    stop();
    expect(ticker.isRunning).toBe(false);
  });

  it('clamps a huge delta after a stall', () => {
    const ticker = new Ticker(0.1);
    const listener = vi.fn();
    ticker.subscribe(listener);

    // The machine slept for ten seconds. Passing that through would teleport
    // the character and skip whole animations.
    raf.frame(10_000);
    expect(listener).toHaveBeenCalledWith(0.1);
  });

  it('keeps running while paused is false and stops when paused', () => {
    const ticker = new Ticker();
    ticker.subscribe(vi.fn());

    ticker.setPaused(true);
    expect(ticker.isRunning).toBe(false);

    ticker.setPaused(false);
    expect(ticker.isRunning).toBe(true);
  });

  it('coalesces frames to respect an fps cap', () => {
    const ticker = new Ticker();
    const listener = vi.fn();
    ticker.subscribe(listener);
    ticker.setMaxFps(30); // ~33ms budget

    // A 120Hz display delivers frames every ~8ms; most must be skipped.
    raf.frame(8);
    raf.frame(8);
    raf.frame(8);
    expect(listener).not.toHaveBeenCalled();

    raf.frame(8);
    expect(listener).toHaveBeenCalledTimes(1);
    // The skipped time is not lost: it arrives as one larger delta, so
    // delta-based movement stays correct.
    expect(listener).toHaveBeenCalledWith(expect.closeTo(0.032, 3));
  });

  it('does not cap when asked for a very high rate', () => {
    const ticker = new Ticker();
    const listener = vi.fn();
    ticker.subscribe(listener);
    ticker.setMaxFps(240);

    raf.frame(8);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps ticking when one subscriber throws', () => {
    const ticker = new Ticker();
    const healthy = vi.fn();
    ticker.subscribe(() => {
      throw new Error('boom');
    });
    ticker.subscribe(healthy);

    raf.frame(16);
    expect(healthy).toHaveBeenCalled();
    // And the loop is still scheduled for the next frame.
    expect(raf.isScheduled).toBe(true);
  });

  it('lets a subscriber unsubscribe during its own tick', () => {
    const ticker = new Ticker();
    const stop = ticker.subscribe(() => stop());
    expect(() => raf.frame(16)).not.toThrow();
  });
});
