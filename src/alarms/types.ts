import { EventPriority } from '@/behavior/EventQueue';
import type { Announcement } from '@/reminders/types';

/**
 * Alarms: the things that happen at a time, rather than at an interval.
 *
 * A reminder says "every 45 minutes, drink some water". An alarm says "the
 * meeting is at eight". That difference runs all the way through: an alarm is
 * anchored to a wall clock, it may want a warning a few minutes beforehand, and
 * it is worthless late — nobody needs to be told at 8:40 that the thing was at
 * eight. Reminders are the opposite on every count, which is why the two have
 * separate schedules and meet only at the point of being announced.
 */

/** Minutes in a day, the modulus every time-of-day is kept inside. */
const DAY_MINUTES = 24 * 60;
const MINUTE_MS = 60_000;

/** How late an alarm may be and still be worth announcing, in milliseconds. */
export const ALARM_STALE_MS = 5 * MINUTE_MS;

/**
 * How close to the alarm an early warning may still be given.
 *
 * A "five minutes to go" that arrives twenty seconds before is worse than
 * none: the alarm itself is already on its way.
 */
const LEAD_FLOOR_MS = 20_000;

/** How long an alarm's bubble stays up, in seconds. */
const ALARM_BUBBLE_SECONDS = 10;
const LEAD_BUBBLE_SECONDS = 8;

export interface Alarm {
  readonly id: string;
  /** What it is for: "Standup", "Take the medicine". Used in what is said. */
  readonly label: string;
  /** What the avatar says when it goes off. Empty falls back to the label. */
  readonly message: string;
  readonly enabled: boolean;
  /** Time of day, in minutes since local midnight. */
  readonly atMinutes: number;
  /** Goes off at the same time every day rather than once. */
  readonly repeatDaily: boolean;
  /** Minutes of warning before it, or 0 for none. */
  readonly leadMinutes: number;
  /** Who delivers it, or null for whoever is on screen. */
  readonly avatarId?: string | null;
  /** The occurrence currently scheduled, in epoch milliseconds. */
  readonly nextTrigger: number;
  /** True once this occurrence's early warning has been given. */
  readonly leadDone: boolean;
  readonly lastTriggered: number | null;
}

/** Which of an alarm's two moments is being announced. */
export type AlarmMoment = 'lead' | 'alarm';

/** How many minutes of warning the settings window offers. */
export const LEAD_CHOICES: readonly number[] = [0, 2, 5, 10, 15, 30];

/**
 * The next time a wall-clock time of day comes round.
 *
 * Built from calendar fields rather than by adding 24 hours, so an alarm set
 * for 08:00 is still at 08:00 after the clocks change rather than drifting to
 * seven or nine.
 */
export function nextOccurrence(atMinutes: number, from: number): number {
  const minutes = normaliseMinutes(atMinutes);
  const at = new Date(from);
  at.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  if (at.getTime() <= from) at.setDate(at.getDate() + 1);
  return at.getTime();
}

/** Anchors an alarm to its next occurrence, clearing the warning it gave. */
export function scheduleAlarm(alarm: Alarm, from: number): Alarm {
  return {
    ...alarm,
    nextTrigger: nextOccurrence(alarm.atMinutes, from),
    leadDone: false,
  };
}

/** When this occurrence's early warning is due, or null if it has none. */
export function leadTime(alarm: Alarm): number | null {
  if (alarm.leadMinutes <= 0) return null;
  return alarm.nextTrigger - alarm.leadMinutes * MINUTE_MS;
}

/** True while an early warning would still be early enough to be useful. */
export function leadIsUseful(alarm: Alarm, now: number): boolean {
  return alarm.nextTrigger - now > LEAD_FLOOR_MS;
}

/** A new alarm for the settings window, an hour from now on the next 5 minutes. */
export function createAlarm(now: number): Alarm {
  const at = new Date(now + 60 * MINUTE_MS);
  const rounded = Math.ceil(at.getMinutes() / 5) * 5;
  const atMinutes = normaliseMinutes(at.getHours() * 60 + rounded);

  return scheduleAlarm(
    {
      id: `alarm-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      label: 'Alarm',
      message: '',
      enabled: true,
      atMinutes,
      repeatDaily: false,
      leadMinutes: 5,
      avatarId: null,
      nextTrigger: now,
      leadDone: false,
      lastTriggered: null,
    },
    now,
  );
}

/** "20:05", for the settings window and the logs. */
export function formatTime(atMinutes: number): string {
  const minutes = normaliseMinutes(atMinutes);
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Parses the value of an `<input type="time">`, or null if it is unusable. */
export function parseTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * What the avatar says, for either of an alarm's two moments.
 *
 * The warning always names the wait, because that is the whole content of it.
 * The alarm itself prefers the user's own words and falls back to the label, so
 * an alarm with nothing typed in still says something sensible.
 */
export function announcementFor(alarm: Alarm, moment: AlarmMoment, now: number): Announcement {
  const label = alarm.label.trim() || 'Alarm';

  if (moment === 'lead') {
    const minutes = Math.max(1, alarm.leadMinutes);
    return {
      // Keyed per occurrence, so a warning that could not be shown before the
      // alarm itself arrived is replaced rather than shown after it.
      key: `alarm:${alarm.id}:lead`,
      title: `${label} (in ${minutes} min)`,
      message: `${label} in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      animation: 'wave',
      bubbleSeconds: LEAD_BUBBLE_SECONDS,
      avatarId: alarm.avatarId ?? null,
      entrance: 'from-edge',
      // Pointless once the alarm it was warning about has arrived.
      expiresAt: alarm.nextTrigger,
      priority: EventPriority.ALARM,
    };
  }

  return {
    key: `alarm:${alarm.id}`,
    title: label,
    message: alarm.message.trim() || `${label} — it's time.`,
    animation: 'surprised',
    bubbleSeconds: ALARM_BUBBLE_SECONDS,
    avatarId: alarm.avatarId ?? null,
    entrance: 'from-edge',
    expiresAt: now + ALARM_STALE_MS,
    priority: EventPriority.ALARM,
  };
}

/** Keeps a time of day inside one day, however it was stored or typed. */
export function normaliseMinutes(atMinutes: number): number {
  if (!Number.isFinite(atMinutes)) return 0;
  const rounded = Math.round(atMinutes);
  return ((rounded % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}
