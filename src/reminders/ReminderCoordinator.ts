import type { AnimationPlayer } from '@/animation/AnimationPlayer';
import { EventPriority, EventQueue } from '@/behavior/EventQueue';
import type { ReminderRepository } from '@/database/ReminderRepository';
import type { SoundPlayer } from '@/services/SoundPlayer';
import { createLogger } from '@/utils/logger';
import { ReminderPerformance } from './ReminderPerformance';
import { ReminderScheduler } from './ReminderScheduler';
import type { Reminder } from './types';

const log = createLogger('REMINDER');

/**
 * How long a queued reminder stays relevant, in milliseconds.
 *
 * A reminder that could not be shown — because the companion was being
 * dragged, or mid-way between displays — should still appear shortly
 * afterwards, but a "drink some water" from twenty minutes ago is noise.
 */
const REMINDER_LIFETIME_MS = 5 * 60_000;

/** What the coordinator needs from the companion around it. */
export interface ReminderHost {
  readonly player: AnimationPlayer;
  /** True while the companion must not be interrupted. */
  isBusy(): boolean;
  /**
   * Called just before a reminder is performed, to clear the way. Receives the
   * reminder so the host can honour its avatar and walk out to deliver it.
   */
  prepareForReminder(reminder: Reminder): void;
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
 * Owns everything about reminders: when they fire, whether they may fire now,
 * and playing them out.
 *
 * Split from the runtime because it is the one subsystem with its own timer,
 * its own queue and its own persistence, and keeping it here leaves the
 * runtime as wiring rather than a place where every concern collects.
 */
export class ReminderCoordinator {
  private readonly events = new EventQueue();
  private readonly scheduler = new ReminderScheduler();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private performance: ReminderPerformance | null = null;
  private pending: Reminder | null = null;
  private repository: Pick<ReminderRepository, 'saveAll'> | null = null;
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
      this.events.clear();
      log.info('Reminders paused');
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
   * Waits until the next reminder is due rather than polling.
   *
   * The scheduler caps how long it will sleep, so a suspended machine or a
   * clock change cannot overshoot by more than half a minute, while an idle
   * companion still only wakes about twice a minute.
   */
  private scheduleNextCheck(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.queueDue();
      this.scheduleNextCheck();
    }, this.scheduler.sleepMs());
  }

  private queueDue(): void {
    if (this.paused) return;

    const now = Date.now();
    const due = this.scheduler.takeDue();
    if (due.length === 0) return;

    // Persist the advanced schedule immediately, so a crash or quit between
    // now and the next write cannot replay the same reminder on restart.
    void this.repository?.saveAll(this.scheduler.all).catch((error: unknown) => {
      log.warn('Could not persist reminder schedule', error);
    });

    for (const reminder of due) {
      this.events.push({
        // Keyed by reminder id, so a reminder that could not be shown appears
        // once when the companion is free again, not once per missed interval.
        key: `reminder:${reminder.id}`,
        priority: EventPriority.REMINDER,
        expiresAt: now + REMINDER_LIFETIME_MS,
        run: () => this.start(reminder),
      });
    }
  }

  private start(reminder: Reminder): void {
    this.host.prepareForReminder(reminder);
    if (this.host.isReadyForReminder?.() === false) {
      this.pending = reminder;
      return;
    }
    this.perform(reminder);
  }

  private perform(reminder: Reminder): void {
    this.sound.play(reminder.sound);
    this.performance = new ReminderPerformance(reminder, this.host.player, {
      showBubble: (text) => this.setBubble(text),
      hideBubble: () => this.setBubble(null),
    });
  }
}
