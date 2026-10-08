import type { AnimationPlayer } from '@/animation/AnimationPlayer';
import { AnimationPriority } from '@/animation/types';
import { createLogger } from '@/utils/logger';
import type { Reminder } from './types';

const log = createLogger('REMINDER');

/**
 * Stages of showing a reminder.
 *
 * Written as an explicit sequence so the companion's behaviour during a
 * reminder is predictable and readable in the log, rather than emerging from
 * a tangle of timers.
 */
export type PerformanceStage = 'greeting' | 'speaking' | 'following-up' | 'closing' | 'done';

/** How long the character waves before the bubble appears, in seconds. */
const GREETING_SECONDS = 0.8;
/** How long the bubble's close transition is given before it is torn down. */
const CLOSING_SECONDS = 0.2;

export interface PerformanceCallbacks {
  readonly showBubble: (text: string) => void;
  readonly hideBubble: () => void;
}

/**
 * Plays out a single reminder: greet, speak, react, then go back to normal.
 *
 * Driven by `update(delta)` from the shared ticker rather than owning timers,
 * so a reminder cannot keep running after the companion is disposed and the
 * whole sequence is deterministic under test.
 */
export class ReminderPerformance {
  private stage: PerformanceStage = 'greeting';
  private elapsed = 0;

  constructor(
    readonly reminder: Reminder,
    private readonly player: AnimationPlayer,
    private readonly callbacks: PerformanceCallbacks,
  ) {
    log.info(`Showing "${reminder.title}"`);
    this.player.play(reminder.animation, {
      priority: AnimationPriority.CRITICAL,
      restart: true,
    });
  }

  get currentStage(): PerformanceStage {
    return this.stage;
  }

  get isFinished(): boolean {
    return this.stage === 'done';
  }

  update(delta: number): void {
    if (this.stage === 'done') return;
    this.elapsed += delta;

    switch (this.stage) {
      case 'greeting':
        if (this.elapsed >= GREETING_SECONDS) this.speak();
        break;

      case 'speaking':
        // The follow-up (drinking, stretching) plays partway through, while
        // the bubble is still up, so the two read as one action.
        if (this.reminder.followUpAnimation && this.elapsed >= this.reminder.bubbleSeconds / 3) {
          this.followUp();
        } else if (this.elapsed >= this.reminder.bubbleSeconds) {
          this.close();
        }
        break;

      case 'following-up':
        if (this.elapsed >= this.reminder.bubbleSeconds) this.close();
        break;

      case 'closing':
        if (this.elapsed >= CLOSING_SECONDS) this.finish();
        break;

      default:
        break;
    }
  }

  /** Ends the reminder early, e.g. because the user grabbed the companion. */
  cancel(): void {
    if (this.stage === 'done') return;
    log.info(`"${this.reminder.title}" dismissed early`);
    this.callbacks.hideBubble();
    this.stage = 'done';
  }

  private speak(): void {
    this.setStage('speaking');
    this.callbacks.showBubble(this.reminder.message);
  }

  private followUp(): void {
    this.setStage('following-up');
    const animation = this.reminder.followUpAnimation;
    if (animation) {
      this.player.play(animation, { priority: AnimationPriority.CRITICAL, restart: true });
    }
  }

  private close(): void {
    this.setStage('closing');
    this.callbacks.hideBubble();
  }

  private finish(): void {
    this.setStage('done');
    this.player.play('idle', { priority: AnimationPriority.AMBIENT, force: true });
    log.info(`"${this.reminder.title}" finished`);
  }

  /**
   * Timings are measured from the start of the *stage* for the short ones, but
   * `speaking` and `following-up` share a clock so `bubbleSeconds` measures
   * the bubble's total time on screen rather than resetting partway.
   */
  private setStage(stage: PerformanceStage): void {
    log.debug(`reminder ${this.stage} -> ${stage}`);
    this.stage = stage;
    if (stage !== 'following-up') this.elapsed = 0;
  }
}
