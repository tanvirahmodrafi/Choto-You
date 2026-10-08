import { createLogger } from '@/utils/logger';
import { systemClock, type Clock } from '@/reminders/ReminderScheduler';
import {
  ALARM_STALE_MS,
  leadIsUseful,
  leadTime,
  nextOccurrence,
  scheduleAlarm,
  type Alarm,
  type AlarmMoment,
} from './types';

const log = createLogger('REMINDER');

/**
 * Never wait longer than this between checks, in milliseconds.
 *
 * Same reasoning as the reminder scheduler: a timer set for hours ahead is not
 * guaranteed to fire on time across a suspend or a clock change, and an alarm
 * is the one thing in the app that must not be late.
 */
const MAX_SLEEP_MS = 30_000;

/** An alarm that is due, and which of its two moments is due. */
export interface DueAlarm {
  readonly alarm: Alarm;
  readonly moment: AlarmMoment;
}

/**
 * Decides when alarms are due.
 *
 * Each occurrence has up to two moments — the early warning and the alarm
 * itself — and the alarm's own record carries which of them has already
 * happened, so a restart cannot replay a warning the user has had.
 *
 * Like the reminder scheduler, this has no opinion about what happens when one
 * fires; it reports and advances.
 */
export class AlarmScheduler {
  private alarms: Alarm[] = [];

  constructor(private readonly clock: Clock = systemClock) {}

  get all(): readonly Alarm[] {
    return this.alarms;
  }

  /**
   * Adopts stored alarms, re-anchoring the repeating ones whose time has passed.
   *
   * A daily alarm stored with a trigger in the past belongs to a day the
   * machine spent switched off; announcing it on launch would be telling the
   * user about a meeting that finished last night, so it moves to its next
   * occurrence. One that is only a few minutes late is kept, because the app
   * has just started and the alarm is still worth having.
   *
   * A one-off is never moved. The user asked for one moment and that moment has
   * gone, so it keeps its time and `takeDue` switches it off — leaving it
   * visibly off in settings, rather than quietly going off a day late.
   */
  restore(alarms: readonly Alarm[]): void {
    const now = this.clock.now();
    this.alarms = alarms.map((alarm) => {
      if (alarm.nextTrigger > now) return alarm;
      if (!alarm.repeatDaily) return alarm;
      if (now - alarm.nextTrigger <= ALARM_STALE_MS) return alarm;
      log.info(`Alarm "${alarm.label}" was missed while the app was closed; moving it on`);
      return scheduleAlarm(alarm, now);
    });
    log.info(`Restored ${this.alarms.length} alarm(s)`, this.enabledIds());
  }

  /** Replaces the whole set, after the user edits them in settings. */
  replaceAll(alarms: readonly Alarm[]): void {
    this.alarms = [...alarms];
  }

  /**
   * Returns the moments that are due now, and advances what produced them.
   *
   * A one-off alarm turns itself off once it has gone off, so it cannot fire
   * again tomorrow; a daily one moves to the next day and forgets that it gave
   * a warning.
   */
  takeDue(): DueAlarm[] {
    const now = this.clock.now();
    const due: DueAlarm[] = [];

    this.alarms = this.alarms.map((alarm) => {
      if (!alarm.enabled) return alarm;

      let current = alarm;
      const lead = leadTime(current);

      if (lead !== null && !current.leadDone && now >= lead) {
        // Marked done either way: a warning too close to the alarm is not
        // worth giving, but it must not be reconsidered every half minute.
        if (leadIsUseful(current, now)) {
          log.info(`Alarm "${current.label}" is ${current.leadMinutes} minute(s) away`);
          due.push({ alarm: current, moment: 'lead' });
        }
        current = { ...current, leadDone: true };
      }

      if (now < current.nextTrigger) return current;

      const late = now - current.nextTrigger;
      if (late <= ALARM_STALE_MS) {
        log.info(`Alarm "${current.label}" is due`);
        due.push({ alarm: current, moment: 'alarm' });
      } else {
        log.warn(`Alarm "${current.label}" was ${Math.round(late / 60_000)} min late; skipping it`);
      }

      if (current.repeatDaily) {
        return {
          ...current,
          lastTriggered: now,
          nextTrigger: nextOccurrence(current.atMinutes, now),
          leadDone: false,
        };
      }
      return { ...current, lastTriggered: now, enabled: false };
    });

    return due;
  }

  /** Milliseconds to wait before the next check. */
  sleepMs(): number {
    const now = this.clock.now();
    let soonest = Number.POSITIVE_INFINITY;

    for (const alarm of this.alarms) {
      if (!alarm.enabled) continue;
      const lead = alarm.leadDone ? null : leadTime(alarm);
      if (lead !== null) soonest = Math.min(soonest, lead);
      soonest = Math.min(soonest, alarm.nextTrigger);
    }

    if (!Number.isFinite(soonest)) return MAX_SLEEP_MS;
    return Math.max(0, Math.min(soonest - now, MAX_SLEEP_MS));
  }

  private enabledIds(): string[] {
    return this.alarms.filter((alarm) => alarm.enabled).map((alarm) => alarm.id);
  }
}
