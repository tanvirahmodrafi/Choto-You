import type { AnimationDefinition } from '@/types/character';

/**
 * Still-image avatar packs.
 *
 * An avatar drawn by hand arrives as a few pictures, not twelve sprite
 * sequences. This module expands whatever the user supplied into the complete
 * set of animation slots the runtime expects, so the rest of the app never has
 * to ask whether the loaded pack is animated.
 *
 * A still is modelled as a one-frame clip rather than as a separate animation
 * format: the player, the loader and the cache then need no special case, and a
 * pack can mix stills with sequences as the artwork improves.
 */

/** Every animation slot the runtime may ask for. */
export const ANIMATION_SLOTS = [
  'idle',
  'walk',
  'jump',
  'fall',
  'land',
  'happy',
  'surprised',
  'dragged',
  'wave',
  'drink',
  'sleep',
  'wake',
] as const;

export type AnimationSlot = (typeof ANIMATION_SLOTS)[number];

/**
 * The slots worth asking a user to draw, in the order the import UI shows them.
 *
 * Deliberately shorter than `ANIMATION_SLOTS`: nobody wants to draw twelve
 * pictures before they can try their avatar out. The rest are filled in by
 * `FALLBACKS`.
 */
export const SUGGESTED_SLOTS: readonly {
  readonly slot: AnimationSlot;
  readonly label: string;
  readonly hint: string;
}[] = [
  { slot: 'idle', label: 'Normal', hint: 'Standing there. The only one that is required.' },
  { slot: 'walk', label: 'Walking', hint: 'Used when it moves across the screen.' },
  { slot: 'happy', label: 'Happy', hint: 'Cheerful reminders and reactions to clicks.' },
  { slot: 'surprised', label: 'Surprised', hint: 'Eye breaks, and being poked.' },
  { slot: 'wave', label: 'Waving', hint: 'How most reminders open.' },
  { slot: 'drink', label: 'Drinking', hint: 'The follow-up to a water reminder.' },
  { slot: 'sleep', label: 'Asleep', hint: 'Shown when you have been idle a while.' },
];

/**
 * Where each slot looks when the pack has no image of its own for it.
 *
 * Every chain ends at `idle`, which is why `idle` is the one slot a pack cannot
 * omit. Chains are listed nearest-match first, so a pack with only `idle` and
 * `happy` still gets a plausible picture for `wave` and `jump`.
 */
const FALLBACKS: Readonly<Record<AnimationSlot, readonly AnimationSlot[]>> = {
  idle: [],
  walk: ['idle'],
  jump: ['happy', 'idle'],
  fall: ['surprised', 'idle'],
  land: ['idle'],
  happy: ['idle'],
  surprised: ['happy', 'idle'],
  dragged: ['surprised', 'idle'],
  wave: ['happy', 'idle'],
  drink: ['happy', 'idle'],
  sleep: ['idle'],
  wake: ['sleep', 'idle'],
};

/**
 * Slots the runtime drives with an `onFinish` callback, and which must
 * therefore end rather than loop.
 *
 * Everything else holds its pose: a reminder keeps its bubble up for several
 * seconds, and a still that stopped after a fraction of a second would snap
 * back to `idle` while the user was still reading.
 */
const ONE_SHOT_SLOTS: readonly AnimationSlot[] = ['jump', 'land', 'wake'];

/**
 * How long a one-shot still is held, in seconds, before it reports completion.
 *
 * Long enough to register as a distinct pose, short enough that the character
 * does not feel stuck. Expressed as a duration and converted to `fps` because
 * a one-frame clip's frame duration *is* its total duration.
 */
const ONE_SHOT_SECONDS = 0.5;

/**
 * Builds the full animation set from the stills a pack provides.
 *
 * @param stills Slot name to pack-relative image path. Unknown slot names are
 *   ignored; a pack is untrusted input and a typo should cost one picture
 *   rather than the whole avatar.
 * @returns One definition per slot, or null if no usable `idle` could be
 *   resolved — the one case where there is nothing sensible to show.
 */
export function expandStills(
  stills: Readonly<Record<string, string>>,
): Readonly<Record<string, AnimationDefinition>> | null {
  const provided: Record<string, AnimationDefinition> = {};
  for (const slot of ANIMATION_SLOTS) {
    const path = stills[slot];
    if (typeof path !== 'string' || path.length === 0) continue;
    provided[slot] = {
      format: 'png-sequence',
      // Overwritten per slot by `fillAnimationSlots`, which knows whether the
      // slot it is filling has to finish or hold.
      fps: 1,
      loop: true,
      frames: [path],
    };
  }

  return fillAnimationSlots(provided);
}

/**
 * Completes a partial animation set by borrowing along the fallback chains.
 *
 * Used both by still packs, where every clip is one frame, and by packs sliced
 * from a sprite sheet, where `idle`, `walk` and `wave` are real sequences and
 * the rest are single poses. A borrowed clip is re-timed for the slot it lands
 * in: a looping walk copied into `land` must be made to finish, or the runtime's
 * `onFinish` never fires and the character is stranded in the pose.
 *
 * @returns One definition per slot, or null when `idle` cannot be resolved.
 */
export function fillAnimationSlots(
  provided: Readonly<Record<string, AnimationDefinition>>,
): Readonly<Record<string, AnimationDefinition>> | null {
  const known = new Map<AnimationSlot, AnimationDefinition>();
  for (const slot of ANIMATION_SLOTS) {
    const definition = provided[slot];
    if (definition && definition.frames.length > 0) known.set(slot, definition);
  }

  if (!known.has('idle')) return null;

  const animations: Record<string, AnimationDefinition> = {};
  for (const slot of ANIMATION_SLOTS) {
    const source = resolveSlot(slot, known);
    if (!source) continue;

    const oneShot = ONE_SHOT_SLOTS.includes(slot);
    animations[slot] = {
      ...source,
      loop: !oneShot,
      // A single-frame one-shot has no sequence to time it, so its lone frame
      // is held for a fixed moment; anything with real frames keeps its own
      // timing, which is what makes it read as movement.
      fps: oneShot && source.frames.length === 1 ? 1 / ONE_SHOT_SECONDS : source.fps,
    };
  }
  return animations;
}

/** Walks a slot's fallback chain until a definition is found. */
function resolveSlot(
  slot: AnimationSlot,
  provided: ReadonlyMap<AnimationSlot, AnimationDefinition>,
): AnimationDefinition | undefined {
  const own = provided.get(slot);
  if (own) return own;
  for (const candidate of FALLBACKS[slot]) {
    const found = provided.get(candidate);
    if (found) return found;
  }
  return undefined;
}

/** True for a slot name the runtime knows about. */
export function isAnimationSlot(name: string): name is AnimationSlot {
  return (ANIMATION_SLOTS as readonly string[]).includes(name);
}
