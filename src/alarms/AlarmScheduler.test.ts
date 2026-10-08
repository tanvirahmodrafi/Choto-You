import { describe, expect, it } from 'vitest';
import { AlarmScheduler } from './AlarmScheduler';
import { announcementFor, createAlarm, nextOccurrence, parseTime, type Alarm } from './types';

/** A clock the test moves by hand. */
function clockAt(start: number) {
  let now = start;
  return {
    clock: { now: () => now },
    set: (time: number) => {
      now = time;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const MINUTE = 60_000;

/** An alarm at a wall-clock time today, relative to `now`. */
function alarmAt(now: number, minutesFromNow: number, overrides: Partial<Alarm> = {}): Alarm {
  const at = new Date(now + minutesFromNow * MINUTE);
  return {
    id: 'standup',
    label: 'Standup',
    message: '',
    enabled: true,
    atMinutes: at.getHours() * 60 + at.getMinutes(),
    repeatDaily: false,
    leadMinutes: 5,
    avatarId: null,
    nextTrigger: new Date(at).setSeconds(0, 0),
    leadDone: false,
    lastTriggered: null,
    ...overrides,
  };
}

describe('next occurrence', () => {
  it('is today when the time is still ahead, and tomorrow once it has passed', () => {
    const morning = new Date(2026, 9, 8, 9, 0, 0, 0).getTime();
    expect(nextOccurrence(10 * 60, morning)).toBe(new Date(2026, 9, 8, 10, 0, 0, 0).getTime());
    expect(nextOccurrence(8 * 60, morning)).toBe(new Date(2026, 9, 9, 8, 0, 0, 0).getTime());
  });

  it('keeps the wall-clock time across a daylight saving change', () => {
    // The night the clocks go back in Europe; a naive "add 24 hours" would
    // land an 08:00 alarm at 07:00.
    const before = new Date(2026, 9, 24, 9, 0, 0, 0).getTime();
    const next = new Date(nextOccurrence(8 * 60, before));
    expect(next.getHours()).toBe(8);
    expect(next.getMinutes()).toBe(0);
  });

  it('reads the value of a time input, and refuses nonsense', () => {
    expect(parseTime('07:55')).toBe(7 * 60 + 55);
    expect(parseTime('23:59')).toBe(23 * 60 + 59);
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('tea time')).toBeNull();
  });
});

describe('alarm scheduler', () => {
  it('warns before the alarm, then announces it', () => {
    const { clock, advance } = clockAt(new Date(2026, 9, 8, 19, 0, 0, 0).getTime());
    const scheduler = new AlarmScheduler(clock);
    scheduler.replaceAll([alarmAt(clock.now(), 10)]);

    expect(scheduler.takeDue()).toEqual([]);

    // Five minutes before: the warning, and only the warning.
    advance(5 * MINUTE);
    const warning = scheduler.takeDue();
    expect(warning).toHaveLength(1);
    expect(warning[0]?.moment).toBe('lead');

    // It is not given twice.
    advance(MINUTE);
    expect(scheduler.takeDue()).toEqual([]);

    advance(4 * MINUTE);
    const due = scheduler.takeDue();
    expect(due).toHaveLength(1);
    expect(due[0]?.moment).toBe('alarm');
  });

  it('switches a one-off alarm off once it has gone off', () => {
    const { clock, advance } = clockAt(new Date(2026, 9, 8, 19, 0, 0, 0).getTime());
    const scheduler = new AlarmScheduler(clock);
    scheduler.replaceAll([alarmAt(clock.now(), 1, { leadMinutes: 0 })]);

    advance(MINUTE);
    expect(scheduler.takeDue()).toHaveLength(1);
    expect(scheduler.all[0]?.enabled).toBe(false);

    // Tomorrow comes and it stays silent.
    advance(24 * 60 * MINUTE);
    expect(scheduler.takeDue()).toEqual([]);
  });

  it('comes round again the next day when it repeats', () => {
    const { clock, advance } = clockAt(new Date(2026, 9, 8, 19, 0, 0, 0).getTime());
    const scheduler = new AlarmScheduler(clock);
    scheduler.replaceAll([alarmAt(clock.now(), 6, { repeatDaily: true, leadMinutes: 5 })]);

    advance(MINUTE);
    expect(scheduler.takeDue().map((due) => due.moment)).toEqual(['lead']);
    advance(5 * MINUTE);
    expect(scheduler.takeDue().map((due) => due.moment)).toEqual(['alarm']);
    expect(scheduler.all[0]?.enabled).toBe(true);
    // Ready to warn again: the warning it gave belonged to today.
    expect(scheduler.all[0]?.leadDone).toBe(false);

    // Tomorrow, five minutes out: the warning, then the alarm.
    advance(24 * 60 * MINUTE - 5 * MINUTE);
    expect(scheduler.takeDue().map((due) => due.moment)).toEqual(['lead']);
    advance(5 * MINUTE);
    expect(scheduler.takeDue().map((due) => due.moment)).toEqual(['alarm']);
  });

  it('skips the warning when it would arrive on top of the alarm', () => {
    const { clock, advance } = clockAt(new Date(2026, 9, 8, 19, 0, 0, 0).getTime());
    const scheduler = new AlarmScheduler(clock);
    // Asleep through the warning; it wakes 10 seconds before the alarm.
    scheduler.replaceAll([alarmAt(clock.now(), 5)]);

    advance(5 * MINUTE - 10_000);
    expect(scheduler.takeDue()).toEqual([]);
    expect(scheduler.all[0]?.leadDone).toBe(true);

    advance(10_000);
    expect(scheduler.takeDue().map((due) => due.moment)).toEqual(['alarm']);
  });

  it('does not announce an alarm the machine slept through', () => {
    const { clock, advance } = clockAt(new Date(2026, 9, 8, 19, 0, 0, 0).getTime());
    const scheduler = new AlarmScheduler(clock);
    scheduler.replaceAll([alarmAt(clock.now(), 5, { leadMinutes: 0, repeatDaily: true })]);

    // Woken an hour late: being told now is worse than useless.
    advance(65 * MINUTE);
    expect(scheduler.takeDue()).toEqual([]);
    // And it has moved on to tomorrow rather than sitting there overdue.
    expect(scheduler.all[0]?.nextTrigger).toBeGreaterThan(clock.now());
  });

  it('moves a repeating alarm on when the app was closed past it', () => {
    const start = new Date(2026, 9, 8, 19, 0, 0, 0).getTime();
    const { clock } = clockAt(start);
    const scheduler = new AlarmScheduler(clock);

    const stored = alarmAt(start, -120, { repeatDaily: true });
    scheduler.restore([stored]);

    expect(scheduler.all[0]?.nextTrigger).toBeGreaterThan(start);
    expect(scheduler.takeDue()).toEqual([]);
  });

  it('keeps a missed one-off alarm, so the user can see it was missed', () => {
    const start = new Date(2026, 9, 8, 19, 0, 0, 0).getTime();
    const { clock } = clockAt(start);
    const scheduler = new AlarmScheduler(clock);

    const stored = alarmAt(start, -120, { repeatDaily: false });
    scheduler.restore([stored]);

    // Not re-anchored to tomorrow: a one-off that never happened is not moved
    // silently to another day.
    expect(scheduler.all[0]?.nextTrigger).toBe(stored.nextTrigger);

    // Taking what is due switches it off instead, without announcing it.
    expect(scheduler.takeDue()).toEqual([]);
    expect(scheduler.all[0]?.enabled).toBe(false);
  });

  it('ignores alarms that are switched off', () => {
    const { clock, advance } = clockAt(new Date(2026, 9, 8, 19, 0, 0, 0).getTime());
    const scheduler = new AlarmScheduler(clock);
    scheduler.replaceAll([alarmAt(clock.now(), 1, { enabled: false, leadMinutes: 0 })]);

    advance(2 * MINUTE);
    expect(scheduler.takeDue()).toEqual([]);
    expect(scheduler.sleepMs()).toBe(30_000);
  });

  it('sleeps until the warning, not until the alarm', () => {
    const { clock } = clockAt(new Date(2026, 9, 8, 19, 0, 0, 0).getTime());
    const scheduler = new AlarmScheduler(clock);
    scheduler.replaceAll([alarmAt(clock.now(), 40, { leadMinutes: 30 })]);

    // Ten minutes to the warning, capped at the half-minute ceiling.
    expect(scheduler.sleepMs()).toBe(30_000);
  });
});

describe('what an alarm says', () => {
  const now = new Date(2026, 9, 8, 19, 0, 0, 0).getTime();

  it('names the wait in the warning', () => {
    const alarm = alarmAt(now, 5, { leadMinutes: 5 });
    const lead = announcementFor(alarm, 'lead', now);
    expect(lead.message).toBe('Standup in 5 minutes.');
    // A warning is pointless once the thing it warned about has arrived.
    expect(lead.expiresAt).toBe(alarm.nextTrigger);
  });

  it('says one minute, not 1 minutes', () => {
    const alarm = alarmAt(now, 1, { leadMinutes: 1 });
    expect(announcementFor(alarm, 'lead', now).message).toBe('Standup in 1 minute.');
  });

  it('prefers the user\'s own words, and falls back to the name', () => {
    const alarm = alarmAt(now, 5, { message: 'Bring the slides.' });
    expect(announcementFor(alarm, 'alarm', now).message).toBe('Bring the slides.');
    expect(announcementFor({ ...alarm, message: '   ' }, 'alarm', now).message).toBe(
      "Standup — it's time.",
    );
  });

  it('outranks a reminder, so a queued one cannot hold it up', async () => {
    const { EventPriority } = await import('@/behavior/EventQueue');
    const alarm = alarmAt(now, 5);
    expect(announcementFor(alarm, 'alarm', now).priority).toBeGreaterThan(EventPriority.REMINDER);
  });

  it('starts a new alarm an hour ahead, on a round five minutes', () => {
    const alarm = createAlarm(new Date(2026, 9, 8, 19, 3, 0, 0).getTime());
    expect(alarm.atMinutes % 5).toBe(0);
    expect(alarm.nextTrigger).toBeGreaterThan(new Date(2026, 9, 8, 19, 3, 0, 0).getTime());
    expect(alarm.enabled).toBe(true);
    expect(alarm.leadMinutes).toBe(5);
  });
});
