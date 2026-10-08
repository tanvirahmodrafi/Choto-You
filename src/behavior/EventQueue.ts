import { createLogger } from '@/utils/logger';

const log = createLogger('STATE');

/** Higher wins. Mirrors the animation priorities so the two stay comparable. */
export const EventPriority = {
  AMBIENT: 0,
  NORMAL: 10,
  REACTION: 20,
  REMINDER: 30,
  /**
   * A clock alarm, which outranks a reminder.
   *
   * A reminder can wait for the next quiet moment; an alarm the user set for a
   * particular minute cannot, and must not be left behind a queued one.
   */
  ALARM: 40,
} as const;

export interface CompanionEvent {
  /** Events sharing a key replace one another rather than piling up. */
  readonly key: string;
  readonly priority: number;
  /** Dropped if it has not run by this time. Epoch milliseconds. */
  readonly expiresAt?: number;
  readonly run: () => void;
}

/**
 * A small priority queue for things the companion should do when it can.
 *
 * Reminders must not interrupt the user mid-drag, and must not be lost either,
 * so they are queued rather than fired immediately. Equally they must not pile
 * up: a water reminder that could not be shown for twenty minutes should
 * appear once, not four times — hence replacement by key and expiry.
 */
export class EventQueue {
  private events: CompanionEvent[] = [];

  get size(): number {
    return this.events.length;
  }

  /** Queues an event, replacing any pending event with the same key. */
  push(event: CompanionEvent): void {
    const existing = this.events.findIndex((candidate) => candidate.key === event.key);
    if (existing !== -1) {
      log.debug(`Event "${event.key}" replaced while still queued`);
      this.events.splice(existing, 1);
    }
    this.events.push(event);
    // Highest priority first; ties keep insertion order so a burst of equal
    // events still runs in the sequence the user would expect.
    this.events.sort((a, b) => b.priority - a.priority);
  }

  peek(now: number): CompanionEvent | null {
    this.dropExpired(now);
    return this.events[0] ?? null;
  }

  /** Removes and returns the highest-priority event that has not expired. */
  take(now: number): CompanionEvent | null {
    this.dropExpired(now);
    return this.events.shift() ?? null;
  }

  remove(key: string): void {
    this.events = this.events.filter((event) => event.key !== key);
  }

  /**
   * Drops queued events, or only those matching a predicate.
   *
   * The filtered form exists because pausing reminders must not throw away a
   * queued alarm: the alarm's own schedule has already moved past it, so a
   * dropped one would never come back.
   */
  clear(matches?: (event: CompanionEvent) => boolean): void {
    this.events = matches ? this.events.filter((event) => !matches(event)) : [];
  }

  private dropExpired(now: number): void {
    const before = this.events.length;
    this.events = this.events.filter((event) => event.expiresAt === undefined || event.expiresAt > now);
    const dropped = before - this.events.length;
    if (dropped > 0) log.debug(`${dropped} queued event(s) expired`);
  }
}
