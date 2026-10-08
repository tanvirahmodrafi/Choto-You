import { createLogger } from '@/utils/logger';
import { AnimationPriority, type AnimationClip, type AnimationState, type PlayOptions } from './types';

const log = createLogger('ANIM');

/** The animation every character must have; used whenever a request cannot be honoured. */
const FALLBACK_CLIP = 'idle';

/**
 * Tolerance for accumulated-time comparisons.
 *
 * Deltas are summed as floats, so an exact frame boundary rarely lands exactly:
 * ten 0.01s ticks sum to 0.09999999999999999, and 0.3 / 0.1 evaluates to
 * 2.9999999999999996. Without this tolerance every animation would run a
 * fraction slow and occasionally skip a beat. One microsecond is far below
 * perceptible and far above the error being corrected.
 */
const TIME_EPSILON = 1e-6;

/**
 * Plays one character's animations.
 *
 * The player is framework-agnostic and owns no timer: something external calls
 * `update(delta)` each tick. That keeps playback deterministic (the same delta
 * sequence always produces the same frames) and testable without a DOM.
 *
 * Interruption is decided by priority rather than by callers checking state:
 * a request is honoured when it outranks what is playing, when the running
 * clip has finished, or when it is forced.
 */
export class AnimationPlayer {
  private clip: AnimationClip;
  private frameIndex = 0;
  private elapsedInFrame = 0;
  private finished = false;
  private priority: number = AnimationPriority.AMBIENT;
  private onFinish: (() => void) | undefined;
  private speed = 1;
  private readonly listeners = new Set<() => void>();

  /** Cached so `getState()` is referentially stable between frame changes. */
  private snapshot: AnimationState;

  constructor(private clips: ReadonlyMap<string, AnimationClip>) {
    const initial = clips.get(FALLBACK_CLIP) ?? [...clips.values()][0];
    if (!initial) {
      throw new Error('AnimationPlayer requires at least one animation');
    }
    this.clip = initial;
    this.snapshot = this.buildSnapshot();
  }

  /** Names of the animations this player can actually play. */
  has(name: string): boolean {
    return this.clips.has(name);
  }

  /**
   * Replaces the whole clip set, for a change of avatar.
   *
   * The animation playing is re-resolved by name in the new set so a swap is
   * invisible when both packs have the pose — a walking character keeps
   * walking. When the new pack lacks it, playback restarts from idle rather
   * than holding a frame that no longer exists.
   *
   * When the pose survives the swap, so does everything expressed through it:
   * the frame, the priority and any pending `onFinish`. A reminder that borrows
   * a different avatar still owns the character, and whatever was waiting on
   * the pose to end is still waiting.
   *
   * When it does not survive, the pose has to be abandoned. The priority is
   * released — holding a priority for a clip that is no longer playing would
   * lock out every later request — and `onFinish` is dropped, because the thing
   * it was waiting for can no longer happen.
   */
  setClips(clips: ReadonlyMap<string, AnimationClip>): void {
    const replacement = clips.get(this.clip.name) ?? clips.get(FALLBACK_CLIP) ?? [...clips.values()][0];
    if (!replacement) {
      log.error('Refusing to swap in an empty clip set');
      return;
    }

    this.clips = clips;

    // The frame index only carries over when the new clip is the same length;
    // otherwise it could point past the end of the replacement's frames.
    if (replacement.name === this.clip.name && replacement.frames.length === this.clip.frames.length) {
      this.clip = replacement;
      this.publish();
      return;
    }

    this.clip = replacement;
    this.frameIndex = 0;
    this.elapsedInFrame = 0;
    this.finished = false;
    this.priority = AnimationPriority.AMBIENT;
    this.onFinish = undefined;
    this.publish();
  }

  get currentName(): string {
    return this.clip.name;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  /**
   * Requests an animation.
   * @returns true if the request was honoured.
   */
  play(name: string, options: PlayOptions = {}): boolean {
    const requested = this.clips.get(name);
    if (!requested) {
      // Missing animations are a content problem, not a crash: fall back to
      // idle so the character keeps moving (requirement: never fail hard on a
      // missing asset).
      log.warn(`Animation "${name}" not available; falling back to "${FALLBACK_CLIP}"`);
      const fallback = this.clips.get(FALLBACK_CLIP);
      if (!fallback || name === FALLBACK_CLIP) return false;
      return this.play(FALLBACK_CLIP, options);
    }

    const priority = options.priority ?? AnimationPriority.NORMAL;
    const outranks = priority >= this.priority;
    const allowed = options.force === true || this.finished || outranks;
    if (!allowed) {
      log.debug(`Ignored "${name}" (priority ${priority}) under "${this.clip.name}" (${this.priority})`);
      return false;
    }

    const sameClip = this.clip.name === requested.name;
    if (sameClip && !options.restart && !this.finished) {
      // Already playing: keep the current frame, but let the new request raise
      // the priority so a reminder can "claim" an animation already running.
      this.priority = Math.max(this.priority, priority);
      return true;
    }

    log.debug(`${this.clip.name} -> ${requested.name}`);
    this.clip = requested;
    this.frameIndex = 0;
    this.elapsedInFrame = 0;
    this.finished = false;
    this.priority = priority;
    this.onFinish = options.onFinish;
    this.publish();
    return true;
  }

  /**
   * Playback rate. 1 is the pack's authored speed; higher is faster.
   * Applied as a multiplier on elapsed time rather than on each clip's fps,
   * so a clip's relative timing is preserved.
   */
  setSpeed(speed: number): void {
    this.speed = Math.min(4, Math.max(0.25, speed));
  }

  /** Advances playback. `delta` is in seconds. */
  update(delta: number): void {
    if (this.finished) return;

    // A looping single-frame clip holds its pose; there is nothing to advance.
    // A *non*-looping one still has to complete, because the caller may be
    // waiting on `onFinish` to hand the character back — and until a clip
    // finishes it keeps its priority, which would lock out every later
    // request. Still-image avatar packs are built entirely from such clips.
    if (this.clip.loop && this.clip.frames.length <= 1) return;

    const secondsPerFrame = 1 / this.clip.fps;
    this.elapsedInFrame += delta * this.speed;
    if (this.elapsedInFrame + TIME_EPSILON < secondsPerFrame) return;

    // A long delta may span several frames; consume them all rather than
    // dropping time, so playback speed stays correct after a stall.
    const advance = Math.floor((this.elapsedInFrame + TIME_EPSILON) / secondsPerFrame);
    this.elapsedInFrame -= advance * secondsPerFrame;

    const next = this.frameIndex + advance;
    if (next < this.clip.frames.length) {
      this.frameIndex = next;
    } else if (this.clip.loop) {
      this.frameIndex = next % this.clip.frames.length;
    } else {
      // Hold the last frame and report completion exactly once.
      this.frameIndex = this.clip.frames.length - 1;
      this.finished = true;
      this.priority = AnimationPriority.AMBIENT;
      const callback = this.onFinish;
      this.onFinish = undefined;
      this.publish();
      callback?.();
      return;
    }
    this.publish();
  }

  getState(): AnimationState {
    return this.snapshot;
  }

  /** Subscribe to frame changes. Shaped for React's `useSyncExternalStore`. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of [...this.listeners]) listener();
  }

  private buildSnapshot(): AnimationState {
    return {
      clip: this.clip,
      frameIndex: this.frameIndex,
      frameUrl: this.clip.frames[this.frameIndex] ?? '',
      finished: this.finished,
    };
  }
}
