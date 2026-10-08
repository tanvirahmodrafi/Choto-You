/**
 * Runtime animation types.
 *
 * These are deliberately separate from the character-pack types: the pack
 * format describes files on disk, while these describe what the player works
 * with in memory. Keeping them apart is what lets a future pack format
 * (sprite sheets, WebP, APNG) resolve to the same runtime clip without
 * touching the player.
 */

export interface AnimationClip {
  readonly name: string;
  readonly fps: number;
  readonly loop: boolean;
  /** Resolved, absolute frame URLs. */
  readonly frames: readonly string[];
}

/** Priority decides which request wins when two animations compete. */
export const AnimationPriority = {
  /** Ambient idling; anything may interrupt it. */
  AMBIENT: 0,
  /** Ordinary locomotion and behaviour. */
  NORMAL: 10,
  /** Direct responses to the user, e.g. a click reaction. */
  REACTION: 20,
  /** Reminders and other things the user must not miss. */
  CRITICAL: 30,
} as const;

export type AnimationPriorityValue = (typeof AnimationPriority)[keyof typeof AnimationPriority];

export interface PlayOptions {
  /**
   * Requests below the running animation's priority are ignored while it is
   * still playing. Defaults to NORMAL.
   */
  readonly priority?: number;
  /** Plays even if an equal-or-higher priority animation is running. */
  readonly force?: boolean;
  /** Restarts from frame 0 even if this animation is already playing. */
  readonly restart?: boolean;
  /** Fired when a non-looping animation reaches its last frame. */
  readonly onFinish?: () => void;
}

export interface AnimationState {
  readonly clip: AnimationClip;
  readonly frameIndex: number;
  readonly frameUrl: string;
  readonly finished: boolean;
}
