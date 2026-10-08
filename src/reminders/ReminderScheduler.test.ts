import { describe, expect, it } from 'vitest';
import { ReminderScheduler, type Clock } from './ReminderScheduler';
import type { ReminderDefinition } from './types';

const MINUTE = 60_000;

function fakeClock(start = 1_000_000): Clock & { advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

const water: ReminderDefinition = {
  id: 'water',
  kind: 'water',
  title: 'Drink water',
  message: 'Time to drink some water!',
  enabled: true,
  intervalMinutes: 45,
  animation: 'happy',
  bubbleSeconds: 8,
};

const eyes: ReminderDefinition = { ...water, id: 'eyes', kind: 'eyes', title: 'Eye break', intervalMinutes: 20 };

describe('ReminderScheduler', () => {
  it('schedules the first trigger one interval ahead', () => {
    const clock = fakeClock();
    const scheduler = new ReminderScheduler(clock);
    scheduler.load([water]);

    expect(scheduler.all[0]?.nextTrigger).toBe(clock.now() + 45 * MINUTE);
    expect(scheduler.takeDue()).toHaveLength(0);
  });

  it('fires a reminder once it is due', () => {
    const clock = fakeClock();
    const scheduler = new ReminderScheduler(clock);
    scheduler.load([water]);

    clock.advance(45 * MINUTE);
    const due = scheduler.takeDue();

    expect(due.map((reminder) => reminder.id)).toEqual(['water']);
    expect(scheduler.takeDue()).toHaveLength(0);
  });

  it('does not fire a disabled reminder, but keeps it scheduled', () => {
    const clock = fakeClock();
    const scheduler = new ReminderScheduler(clock);
    scheduler.load([{ ...water, enabled: false }]);

    clock.advance(45 * MINUTE);
    expect(scheduler.takeDue()).toHaveLength(0);
    // Rescheduled anyway, so enabling it later does not fire instantly.
    expect(scheduler.all[0]?.nextTrigger).toBe(clock.now() + 45 * MINUTE);
  });

  it('fires only once after a long sleep, not once per missed interval', () => {
    const clock = fakeClock();
    const scheduler = new ReminderScheduler(clock);
    scheduler.load([water]);

    // The laptop was closed for six hours.
    clock.advance(6 * 60 * MINUTE);
    expect(scheduler.takeDue()).toHaveLength(1);
    expect(scheduler.takeDue()).toHaveLength(0);
  });

  it('measures the next trigger from when it fired, not from the schedule', () => {
    const clock = fakeClock();
    const scheduler = new ReminderScheduler(clock);
    scheduler.load([water]);

    clock.advance(50 * MINUTE); // five minutes late
    scheduler.takeDue();

    expect(scheduler.all[0]?.nextTrigger).toBe(clock.now() + 45 * MINUTE);
  });

  it('fires several reminders that come due together', () => {
    const clock = fakeClock();
    const scheduler = new ReminderScheduler(clock);
    scheduler.load([water, eyes]);

    clock.advance(45 * MINUTE);
    expect(scheduler.takeDue()).toHaveLength(2);
  });

  it('sleeps until the soonest reminder, capped', () => {
    const clock = fakeClock();
    const scheduler = new ReminderScheduler(clock);
    scheduler.load([water, eyes]);

    // Capped so a suspended machine or a clock jump cannot overshoot badly.
    expect(scheduler.sleepMs()).toBe(30_000);

    clock.advance(20 * MINUTE - 5_000);
    expect(scheduler.sleepMs()).toBe(5_000);
  });

  it('never returns a negative sleep', () => {
    const clock = fakeClock();
    const scheduler = new ReminderScheduler(clock);
    scheduler.load([water]);
    clock.advance(99 * MINUTE);
    expect(scheduler.sleepMs()).toBe(0);
  });

  it('falls back to the cap when nothing is enabled', () => {
    const scheduler = new ReminderScheduler(fakeClock());
    scheduler.load([{ ...water, enabled: false }]);
    expect(scheduler.sleepMs()).toBe(30_000);
  });

  it('defers everything when reminders are paused', () => {
    const clock = fakeClock();
    const scheduler = new ReminderScheduler(clock);
    scheduler.load([water]);
    const before = scheduler.all[0]!.nextTrigger;

    scheduler.deferAll(10 * MINUTE);
    expect(scheduler.all[0]?.nextTrigger).toBe(before + 10 * MINUTE);
  });
});
