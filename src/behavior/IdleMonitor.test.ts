import { describe, expect, it } from 'vitest';
import { IdleMonitor } from './IdleMonitor';

function withClock(idleAfterSeconds = 60) {
  let now = 1_000_000;
  const monitor = new IdleMonitor(idleAfterSeconds, () => now);
  return { monitor, advance: (seconds: number) => { now += seconds * 1000; } };
}

describe('IdleMonitor', () => {
  it('starts active', () => {
    const { monitor } = withClock();
    expect(monitor.isIdle).toBe(false);
  });

  it('becomes idle once nothing has happened for long enough', () => {
    const { monitor, advance } = withClock(60);
    advance(59);
    expect(monitor.update()).toBe(false);
    expect(monitor.isIdle).toBe(false);

    advance(2);
    expect(monitor.update()).toBe(true);
    expect(monitor.isIdle).toBe(true);
  });

  it('reports a change only once per transition', () => {
    const { monitor, advance } = withClock(60);
    advance(61);
    expect(monitor.update()).toBe(true);
    expect(monitor.update()).toBe(false);
  });

  it('counts cursor movement as the user being present', () => {
    const { monitor, advance } = withClock(60);
    monitor.observeCursor({ x: 100, y: 100 });
    advance(61);
    monitor.observeCursor({ x: 400, y: 300 });

    expect(monitor.update()).toBe(false);
    expect(monitor.isIdle).toBe(false);
  });

  it('ignores cursor jitter', () => {
    const { monitor, advance } = withClock(60);
    monitor.observeCursor({ x: 100, y: 100 });
    advance(61);
    // A trackpad under a resting finger drifts by a pixel; that is not the
    // user coming back.
    monitor.observeCursor({ x: 101, y: 100 });

    expect(monitor.update()).toBe(true);
    expect(monitor.isIdle).toBe(true);
  });

  it('wakes on deliberate interaction even without cursor movement', () => {
    const { monitor, advance } = withClock(60);
    advance(61);
    monitor.update();
    expect(monitor.isIdle).toBe(true);

    monitor.markActive();
    expect(monitor.isIdle).toBe(false);
  });

  it('honours a changed threshold', () => {
    const { monitor, advance } = withClock(600);
    advance(61);
    expect(monitor.update()).toBe(false);

    monitor.setIdleAfterSeconds(60);
    expect(monitor.update()).toBe(true);
  });

  it('reports how long it has been idle', () => {
    const { monitor, advance } = withClock(60);
    advance(90);
    expect(monitor.idleForSeconds).toBeCloseTo(90, 5);
  });
});
