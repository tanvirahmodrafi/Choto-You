/**
 * Reminder model.
 *
 * Times are epoch milliseconds so they survive being written to and read back
 * from the database in Phase 8 without timezone ambiguity.
 */

export type ReminderKind = 'water' | 'stand' | 'stretch' | 'eyes' | 'focus' | 'custom';

export interface Reminder {
  readonly id: string;
  readonly kind: ReminderKind;
  readonly title: string;
  readonly message: string;
  readonly enabled: boolean;
  /** How often it fires, in minutes. */
  readonly intervalMinutes: number;
  /** Animation played when it fires; falls back to idle if the pack lacks it. */
  readonly animation: string;
  /**
   * Avatar to wear while this reminder plays, or null to keep the current one.
   *
   * Lets a reminder arrive as a different character — a stern one to stand up, a
   * cheerful one to drink water. The avatar is swapped in for the performance
   * and swapped back when it ends.
   */
  readonly avatarId?: string | null;
  /** Optional follow-up animation, e.g. drinking after a water reminder. */
  readonly followUpAnimation?: string;
  /** How long the speech bubble stays up, in seconds. */
  readonly bubbleSeconds: number;
  readonly sound?: string;
  readonly lastTriggered: number | null;
  readonly nextTrigger: number;
}

/** A reminder before it has ever been scheduled. */
export type ReminderDefinition = Omit<Reminder, 'lastTriggered' | 'nextTrigger'>;

export const BUILT_IN_REMINDERS: readonly ReminderDefinition[] = [
  {
    id: 'water',
    kind: 'water',
    title: 'Drink water',
    message: 'Time to drink some water!',
    enabled: true,
    intervalMinutes: 45,
    animation: 'wave',
    followUpAnimation: 'drink',
    bubbleSeconds: 8,
  },
  {
    id: 'eyes',
    kind: 'eyes',
    title: 'Eye break',
    message: 'Look 20 feet away for 20 seconds.',
    enabled: true,
    intervalMinutes: 20,
    animation: 'surprised',
    bubbleSeconds: 8,
  },
  {
    id: 'stand',
    kind: 'stand',
    title: 'Stand up',
    message: 'Stand up and move around a little.',
    enabled: true,
    intervalMinutes: 60,
    animation: 'happy',
    bubbleSeconds: 8,
  },
  {
    id: 'stretch',
    kind: 'stretch',
    title: 'Stretch',
    message: 'Time for a stretch!',
    enabled: false,
    intervalMinutes: 90,
    animation: 'happy',
    bubbleSeconds: 8,
  },
];

const MINUTE_MS = 60_000;

/**
 * Builds a new user-created reminder.
 *
 * Ids are prefixed and timestamped so a custom reminder can never collide with
 * a built-in one, or with another created in the same session.
 */
export function createCustomReminder(now: number): Reminder {
  return {
    id: `custom-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    kind: 'custom',
    title: 'New reminder',
    message: 'Time for a break.',
    enabled: true,
    intervalMinutes: 30,
    animation: 'wave',
    bubbleSeconds: 8,
    lastTriggered: null,
    nextTrigger: now + 30 * 60_000,
  };
}

/** True for reminders the user added, which may be renamed and deleted. */
export function isCustom(reminder: Reminder): boolean {
  return reminder.kind === 'custom';
}

/** Schedules a definition for the first time. */
export function scheduleNew(definition: ReminderDefinition, now: number): Reminder {
  return {
    ...definition,
    lastTriggered: null,
    nextTrigger: now + definition.intervalMinutes * MINUTE_MS,
  };
}

/**
 * Moves a reminder on after it fires.
 *
 * The next time is measured from *now* rather than from the previous due time.
 * Anchoring to the schedule would make a companion that was asleep, or a
 * laptop that was closed, fire a burst of overdue reminders the moment it woke.
 */
export function reschedule(reminder: Reminder, now: number): Reminder {
  return {
    ...reminder,
    lastTriggered: now,
    nextTrigger: now + reminder.intervalMinutes * MINUTE_MS,
  };
}

/** Applies an edited interval, keeping the remaining wait proportional. */
export function withInterval(reminder: Reminder, intervalMinutes: number, now: number): Reminder {
  return {
    ...reminder,
    intervalMinutes,
    nextTrigger: now + intervalMinutes * MINUTE_MS,
  };
}
