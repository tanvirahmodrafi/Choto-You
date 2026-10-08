import type { AnimationPlayer } from '@/animation/AnimationPlayer';
import { AlarmScheduler } from '@/alarms/AlarmScheduler';
import { announcementFor as announcementForAlarm, type Alarm } from '@/alarms/types';
import { EventQueue } from '@/behavior/EventQueue';
import type { AlarmRepository } from '@/database/AlarmRepository';
import type { ReminderRepository } from '@/database/ReminderRepository';
import type { SoundPlayer } from '@/services/SoundPlayer';
import { createLogger } from '@/utils/logger';
import { ReminderPerformance } from './ReminderPerformance';
import { ReminderScheduler } from './ReminderScheduler';
import { announcementFor, type Announcement, type Reminder } from './types';

const log = createLogger('REMINDER');

/** What the coordinator needs from the companion around it. */
export interface ReminderHost {
  readonly player: AnimationPlayer;
  /** True while the companion must not be interrupted. */
  isBusy(): boolean;
  /**
   * Called just before an announcement is performed, to clear the way. Receives
   * it so the host can honour its avatar and walk out to deliver it.
   */
  prepareForReminder(announcement: Announcement): void;
  /** Entrance choreography must finish before the greeting and message start. */
  isReadyForReminder?(): boolean;
  /**
   * Called once a reminder is over, however it ended — played out, or
   * dismissed early. The host uses it to undo whatever `prepareForReminder`
   * set up: a borrowed avatar, or a parking spot to walk back to.
   */
  finishReminder(): void;
}

/**
 * Owns everything that interrupts the user: when it fires, whether it may fire
 * now, and playing it out.
 *
 * Two different schedules feed it — interval reminders and clock alarms — and
 * they meet here, as `Announcement`s, because everything past the moment of
 * being due is identical. One queue rather than two is what lets an alarm
 * outrank a reminder instead of the pair of them racing for the companion.
 *
 * Split from the runtime because it is the one subsystem with its own timer,
 * its own queue and its own persistence, and keeping it here leaves the
 * runtime as wiring rather than a place where every concern collects.
 */
export class ReminderCoordinator {
  private readonly events = new EventQueue();
  private readonly scheduler = new ReminderScheduler();
  private readonly alarms = new AlarmScheduler();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private performance: ReminderPerformance | null = null;
  private pending: Announcement | null = null;
  private repository: Pick<ReminderRepository, 'saveAll'> | null = null;
  private alarmRepository: Pick<AlarmRepository, 'saveAll'> | null = null;
  private paused = false;
  private pausedAt: number | null = null;
  private bubbleText: string | null = null;
  private readonly bubbleListeners = new Set<() => void>();

  constructor(
    private readonly host: ReminderHost,
    private readonly sound: SoundPlayer,
  ) {}

  /** Adopts saved reminders and begins scheduling. */
  adopt(repository: Pick<ReminderRepository, 'saveAll'>, reminders: readonly Reminder[]): void {
    this.repository = repository;
    this.scheduler.restore(reminders);
    this.scheduleNextCheck();
  }

  /** Adopts saved alarms and begins scheduling them. */
  adoptAlarms(repository: Pick<AlarmRepository, 'saveAll'>, alarms: readonly Alarm[]): void {
    this.alarmRepository = repository;
    this.alarms.restore(alarms);
    this.scheduleNextCheck();
  }

  /**
   * Takes on reminders and alarms edited in the settings window.
   *
   * The settings window writes to the database and says so; this is the
   * overlay applying what it was told, rather than either window trying to
   * keep the other's copy up to date.
   */
  adoptEdits(options: {
    readonly reminders?: readonly Reminder[];
    readonly alarms?: readonly Alarm[];
  }): void {
    if (options.reminders) this.scheduler.replaceAll(options.reminders);
    if (options.alarms) this.alarms.restore(options.alarms);
    this.scheduleNextCheck();
  }

  /** Begins scheduling with no persistence, used when the database failed. */
  startWithout(): void {
    this.scheduler.load([]);
    this.scheduleNextCheck();
  }

  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // No `finishReminder` here: this runs during teardown, and asking the host
    // to walk somewhere or load a pack as it is being disposed is pointless at
    // best.
    this.performance?.cancel();
    this.performance = null;
    this.pending = null;
  }

  get isPerforming(): boolean {
    return this.performance !== null || this.pending !== null;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /**
   * Pauses or resumes reminders.
   *
   * Resuming pushes every schedule forward by however long the pause lasted,
   * rather than letting the backlog fire at once the moment reminders are
   * switched back on.
   */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;

    if (paused) {
      this.pausedAt = Date.now();
      // Only reminders. An alarm the user set for a particular minute is a
      // commitment they made, not an interruption the app decided to make, and
      // its own schedule has already moved past the queued copy — dropping it
      // would lose it altogether.
      this.events.clear((event) => event.key.startsWith('reminder:'));
      log.info('Reminders paused; alarms still ring');
      return;
    }

    if (this.pausedAt !== null) {
      this.scheduler.deferAll(Date.now() - this.pausedAt);
      this.pausedAt = null;
    }
    log.info('Reminders resumed');
    this.scheduleNextCheck();
  }

  /** Advances a reminder in progress, and starts a queued one when free. */
  update(delta: number): void {
    if (this.pending) {
      if (this.host.isReadyForReminder?.() === false) return;
      const reminder = this.pending;
      this.pending = null;
      this.perform(reminder);
      return;
    }
    if (this.performance) {
      this.performance.update(delta);
      if (this.performance.isFinished) {
        this.performance = null;
        this.host.finishReminder();
      }
      return;
    }
    if (this.host.isBusy()) return;
    this.events.take(Date.now())?.run();
  }

  /** Ends a reminder early, e.g. because the user grabbed the companion. */
  cancelCurrent(): void {
    if (this.pending) {
      this.pending = null;
      this.host.finishReminder();
      return;
    }
    if (!this.performance) return;
    this.performance.cancel();
    this.performance = null;
    // The host still has to be put back: an avatar borrowed for this reminder
    // would otherwise stay on, and a parked one would never walk home.
    this.host.finishReminder();
  }

  // --- bubble -------------------------------------------------------------

  getBubbleText(): string | null {
    return this.bubbleText;
  }

  subscribeBubble = (listener: () => void): (() => void) => {
    this.bubbleListeners.add(listener);
    return () => this.bubbleListeners.delete(listener);
  };

  private setBubble(text: string | null): void {
    if (this.bubbleText === text) return;
    this.bubbleText = text;
    for (const listener of [...this.bubbleListeners]) listener();
  }

  // --- scheduling ---------------------------------------------------------

  /**
   * Waits until the next thing is due rather than polling.
   *
   * Whichever schedule wants waking first decides the wait. Both cap how long
   * they will sleep, so a suspended machine or a clock change cannot overshoot
   * by more than half a minute, while an idle companion still only wakes about
   * twice a minute.
   */
  private scheduleNextCheck(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    const wait = Math.min(this.scheduler.sleepMs(), this.alarms.sleepMs());
    this.timer = setTimeout(() => {
      this.queueDue();
      this.scheduleNextCheck();
    }, wait);
  }

  private queueDue(): void {
    this.queueDueAlarms();
    if (this.paused) return;

    const now = Date.now();
    const due = this.scheduler.takeDue();
    if (due.length === 0) return;

    // Persist the advanced schedule immediately, so a crash or quit between
    // now and the next write cannot replay the same reminder on restart.
    void this.repository?.saveAll(this.scheduler.all).catch((error: unknown) => {
      log.warn('Could not persist reminder schedule', error);
    });

    for (const reminder of due) this.queue(announcementFor(reminder, now));
  }

  /**
   * Alarms, which keep their own counsel.
   *
   * Taken whether or not reminders are paused: see `setPaused`.
   */
  private queueDueAlarms(): void {
    const now = Date.now();
    const due = this.alarms.takeDue();
    if (due.length === 0) return;

    void this.alarmRepository?.saveAll(this.alarms.all).catch((error: unknown) => {
      log.warn('Could not persist alarm schedule', error);
    });

    for (const { alarm, moment } of due) {
      this.queue(announcementForAlarm(alarm, moment, now));
    }
  }

  private queue(announcement: Announcement): void {
    this.events.push({
      key: announcement.key,
      priority: announcement.priority,
      expiresAt: announcement.expiresAt,
      run: () => this.start(announcement),
    });
  }

  private start(announcement: Announcement): void {
    this.host.prepareForReminder(announcement);
    if (this.host.isReadyForReminder?.() === false) {
      this.pending = announcement;
      return;
    }
    this.perform(announcement);
  }

  private perform(announcement: Announcement): void {
    this.sound.play(announcement.sound);
    this.performance = new ReminderPerformance(announcement, this.host.player, {
      showBubble: (text) => this.setBubble(text),
      hideBubble: () => this.setBubble(null),
    });
  }
}
