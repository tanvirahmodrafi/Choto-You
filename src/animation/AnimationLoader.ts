import { resolveAssetUrl, type LoadedCharacter } from '@/types/character';
import { createLogger } from '@/utils/logger';
import { AnimationCache } from './AnimationCache';
import type { AnimationClip } from './types';

const log = createLogger('ANIM');

export interface LoadedAnimations {
  readonly clips: ReadonlyMap<string, AnimationClip>;
  readonly cache: AnimationCache;
}

/**
 * Turns a character pack's declarative animation list into runtime clips with
 * absolute URLs, and warms the frame cache.
 *
 * This is the one place that knows how a pack's asset format maps onto runtime
 * clips, so adding sprite sheets or WebP later means extending this function
 * rather than the player.
 */
export async function loadAnimations(character: LoadedCharacter): Promise<LoadedAnimations> {
  const cache = new AnimationCache();
  const clips = new Map<string, AnimationClip>();
  const allFrames: string[] = [];

  for (const [name, definition] of Object.entries(character.manifest.animations)) {
    const frames = definition.frames.map((frame) => resolveAssetUrl(character, frame));
    clips.set(name, { name, fps: definition.fps, loop: definition.loop, frames });
    allFrames.push(...frames);
  }

  const failed = await cache.preload(allFrames);

  // Drop frames that could not be decoded, so the player never stalls on a
  // blank frame. An animation that loses every frame is removed outright and
  // the player falls back to idle when it is requested.
  if (failed.length > 0) {
    const broken = new Set(failed);
    for (const [name, clip] of [...clips]) {
      const usable = clip.frames.filter((frame) => !broken.has(frame));
      if (usable.length === 0) {
        log.error(`Animation "${name}" has no loadable frames; removing it`);
        clips.delete(name);
      } else if (usable.length !== clip.frames.length) {
        log.warn(`Animation "${name}" lost ${clip.frames.length - usable.length} frame(s)`);
        clips.set(name, { ...clip, frames: usable });
      }
    }
  }

  log.info(`Prepared ${clips.size} animation(s)`, [...clips.keys()]);
  return { clips, cache };
}
