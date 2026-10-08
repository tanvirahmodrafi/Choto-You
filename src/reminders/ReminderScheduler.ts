import { createLogger } from '@/utils/logger';
import { reschedule, scheduleNew, type Reminder, type ReminderDefinition } from './types';

const log = createLogger('REMINDER');

/**
 * Never wait longer than this between checks, in milliseconds.
 *
 * The scheduler sleeps until the next reminder is due rather than polling, but
 * a long sleep is unreliable: the machine may suspend, the clock may jump, and
 * a timer set for an hour away is not guaranteed to fire on time. Capping the
 * wait bounds the error to half a minute while still costing only two wakeups
 * a minute when nothing is due.
 */
const MAX_SLEEP_MS = 30_000;

/**
 * Breathing room given to a reminder that came due while the app was closed.
 *
 * Firing the instant the companion appears would be startling, and several
 * overdue reminders would arrive at once.
 */
const GRACE_MS = 60_000;

/** A clock, injectable so the scheduler can be tested without waiting. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/**
 * Decides when reminders are due.
 *
 * Deliberately has no opinion on what happens when one fires — it reports due
 * reminders and reschedules them. Performing a reminder is the engine's job.
 */
export class ReminderScheduler {
  private reminders: Reminder[] = [];

  constructor(private readonly clock: Clock = systemClock) {}

  get all(): readonly Reminder[] {
    return this.reminders;
  }

  /** Schedules fresh definitions, starting every cycle from now. */
  load(definitions: readonly ReminderDefinition[]): void {
    const now = this.clock.now();
    this.reminders = definitions.map((definition) => scheduleNew(definition, now));
    log.info(`Loaded ${this.reminders.length} reminder(s)`, this.enabledIds());
  }

  /**
   * Restores reminders that already carry their own schedule.
   *
   * Used on startup: a reminder's cycle should continue across a restart
   * rather than beginning again, or a companion that restarts often would
   * never reach a long interval.
   */
  restore(reminders: readonly Reminder[]): void {
    const now = this.clock.now();
    this.reminders = reminders.map((reminder) =>
      // A trigger far in the past means the machine was off; bring it forward
      // so it fires shortly rather than immediately on launch.
      reminder.nextTrigger < now ? { ...reminder, nextTrigger: now + GRACE_MS } : reminder,
    );
    log.info(`Restored ${this.reminders.length} reminder(s)`, this.enabledIds());
  }

  /** Replaces the whole set, e.g. after the user edits them in settings. */
  replaceAll(reminders: readonly Reminder[]): void {
    this.reminders = [...reminders];
  }

  /** Replaces a reminder, e.g. after it is edited in settings. */
  update(reminder: Reminder): void {
    const index = this.reminders.findIndex((candidate) => candidate.id === reminder.id);
    if (index === -1) return;
    this.reminders[index] = reminder;
  }

  /**
   * Returns reminders that are due now and advances them.
   *
   * Disabled reminders are skipped but still rescheduled, so re-enabling one
   * does not fire it instantly with a long-overdue timestamp.
   */
  takeDue(): Reminder[] {
    const now = this.clock.now();
    const due: Reminder[] = [];

    this.reminders = this.reminders.map((reminder) => {
      if (reminder.nextTrigger > now) return reminder;
      const advanced = reschedule(reminder, now);
      if (reminder.enabled) {
        log.info(`${reminder.title} reminder triggered`);
        due.push(advanced);
      }
      return advanced;
    });

    return due;
  }

  /** Milliseconds to wait before the next check. */
  sleepMs(): number {
    const now = this.clock.now();
    const soonest = this.reminders
      .filter((reminder) => reminder.enabled)
      .reduce((earliest, reminder) => Math.min(earliest, reminder.nextTrigger), Number.POSITIVE_INFINITY);

    if (!Number.isFinite(soonest)) return MAX_SLEEP_MS;
    return Math.max(0, Math.min(soonest - now, MAX_SLEEP_MS));
  }

  /** Pushes every enabled reminder out by a delay, used when paused. */
  deferAll(byMs: number): void {
    this.reminders = this.reminders.map((reminder) => ({
      ...reminder,
      nextTrigger: reminder.nextTrigger + byMs,
    }));
  }

  private enabledIds(): string[] {
    return this.reminders.filter((reminder) => reminder.enabled).map((reminder) => reminder.id);
  }
}
