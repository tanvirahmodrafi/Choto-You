import { describe, expect, it, vi } from 'vitest';
import { EventPriority, EventQueue } from './EventQueue';

const NOW = 1_000_000;

function event(key: string, priority: number, expiresAt?: number) {
  const run = vi.fn();
  return { event: { key, priority, run, ...(expiresAt === undefined ? {} : { expiresAt }) }, run };
}

describe('EventQueue', () => {
  it('returns the highest priority event first', () => {
    const queue = new EventQueue();
    queue.push(event('walk', EventPriority.NORMAL).event);
    queue.push(event('water', EventPriority.REMINDER).event);
    queue.push(event('blink', EventPriority.AMBIENT).event);

    expect(queue.take(NOW)?.key).toBe('water');
    expect(queue.take(NOW)?.key).toBe('walk');
    expect(queue.take(NOW)?.key).toBe('blink');
  });

  it('keeps insertion order within one priority', () => {
    const queue = new EventQueue();
    queue.push(event('first', EventPriority.NORMAL).event);
    queue.push(event('second', EventPriority.NORMAL).event);

    expect(queue.take(NOW)?.key).toBe('first');
    expect(queue.take(NOW)?.key).toBe('second');
  });

  it('replaces a pending event with the same key instead of stacking', () => {
    const queue = new EventQueue();
    // A reminder that could not be shown for twenty minutes should appear
    // once, not four times.
    queue.push(event('water', EventPriority.REMINDER).event);
    queue.push(event('water', EventPriority.REMINDER).event);
    queue.push(event('water', EventPriority.REMINDER).event);

    expect(queue.size).toBe(1);
  });

  it('drops events that expired while they waited', () => {
    const queue = new EventQueue();
    queue.push(event('stale', EventPriority.REMINDER, NOW - 1).event);
    queue.push(event('fresh', EventPriority.NORMAL, NOW + 10_000).event);

    expect(queue.take(NOW)?.key).toBe('fresh');
    expect(queue.size).toBe(0);
  });

  it('peek does not consume', () => {
    const queue = new EventQueue();
    queue.push(event('water', EventPriority.REMINDER).event);

    expect(queue.peek(NOW)?.key).toBe('water');
    expect(queue.size).toBe(1);
  });

  it('can withdraw a queued event by key', () => {
    const queue = new EventQueue();
    queue.push(event('water', EventPriority.REMINDER).event);
    queue.remove('water');

    expect(queue.take(NOW)).toBeNull();
  });

  it('returns null when empty', () => {
    expect(new EventQueue().take(NOW)).toBeNull();
  });
});
