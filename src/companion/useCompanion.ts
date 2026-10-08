import { useEffect, useState, useSyncExternalStore } from 'react';
import { SettingsRepository } from '@/database/SettingsRepository';
import { DEFAULT_AVATAR_ID } from '@/characters/AvatarRegistry';
import type { AnimationPlayer } from '@/animation/AnimationPlayer';
import type { AnimationState } from '@/animation/types';
import type { MovementEngine, MovementSnapshot } from '@/movement/MovementEngine';
import { createLogger } from '@/utils/logger';
import { CompanionRuntime } from './CompanionRuntime';

const log = createLogger('APP');

export type CompanionStatus =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly runtime: CompanionRuntime }
  | { readonly status: 'failed'; readonly message: string };

/**
 * Creates the runtime once and tears it down on unmount.
 *
 * `avatarId` is only the pack to *start* with. Later changes are applied by the
 * runtime itself, which swaps the artwork in place — recreating the runtime
 * would reset the character's position and restart its reminders every time the
 * user clicked a different avatar in the picker.
 */
export function useCompanion(avatarId: string | null): CompanionStatus {
  const [state, setState] = useState<CompanionStatus>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let created: CompanionRuntime | null = null;

    /**
     * Retries startup a few times.
     *
     * Everything the runtime needs at launch — displays, the database, the
     * character pack — can fail transiently while the machine wakes. A
     * companion that gives up on the first failure stays invisible until the
     * user notices and restarts it, which they have no reason to think of.
     */
    async function createWithRetry(attempt = 1): Promise<CompanionRuntime> {
      try {
        return await CompanionRuntime.create(avatarId ?? undefined);
      } catch (error) {
        if (attempt >= 3) throw error;
        log.warn(`Startup attempt ${attempt} failed; retrying`, error);
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        return createWithRetry(attempt + 1);
      }
    }

    if (avatarId === null) {
      // Still reading which avatar was chosen; creating now would show the
      // wrong character for a moment.
      return;
    }

    createWithRetry()
      .then((runtime) => {
        created = runtime;
        // React may unmount before this resolves (StrictMode does exactly
        // that); dispose immediately rather than leaking a ticking runtime.
        if (cancelled) {
          runtime.dispose();
          return;
        }
        setState({ status: 'ready', runtime });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        log.error('Companion failed to start; overlay will stay empty', message);
        if (!cancelled) setState({ status: 'failed', message });
      });

    return () => {
      cancelled = true;
      created?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see the note above:
    // only the first non-null id may create a runtime.
  }, [avatarId === null]);

  return state;
}

export function useAnimationState(player: AnimationPlayer): AnimationState {
  return useSyncExternalStore(player.subscribe, () => player.getState());
}

export function useMovementState(movement: MovementEngine): MovementSnapshot {
  return useSyncExternalStore(movement.subscribe, () => movement.getSnapshot());
}

/** Re-renders when settings change, e.g. the character's size or debug mode. */
export function useSettingsRevision(runtime: CompanionRuntime): number {
  const [revision, setRevision] = useState(0);
  useEffect(
    () => runtime.subscribeSettings(() => setRevision((current) => current + 1)),
    [runtime],
  );
  return revision;
}

/** The current speech-bubble text, or null when no bubble is showing. */
export function useBubbleText(runtime: CompanionRuntime): string | null {
  return useSyncExternalStore(runtime.subscribeBubble, () => runtime.getBubbleText());
}


/**
 * Reads which avatar to start with, once.
 *
 * A one-shot read rather than a subscription: the runtime owns every later
 * change, and a second live settings store in this window would be duplicated
 * state for no gain. Returns null while the read is in flight, which is the
 * overlay's signal to draw nothing rather than the wrong character.
 */
export function useInitialAvatarId(): string | null {
  const [avatarId, setAvatarId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const repository = await SettingsRepository.open();
        const settings = await repository.loadSettings();
        if (!cancelled) setAvatarId(settings.character.characterId);
      } catch (error) {
        // A companion on the default avatar beats no companion at all.
        log.warn('Could not read the chosen avatar; starting with the default', error);
        if (!cancelled) setAvatarId(DEFAULT_AVATAR_ID);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return avatarId;
}
