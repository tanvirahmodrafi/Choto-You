import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { CharacterRenderer } from './CharacterRenderer';
import type { CompanionRuntime } from './CompanionRuntime';
import { SpeechBubble } from './SpeechBubble';
import {
  useAnimationState,
  useBubbleText,
  useCompanion,
  useInitialAvatarId,
  useMovementState,
  useSettingsRevision,
} from './useCompanion';

/**
 * Root of the transparent overlay window.
 *
 * The character is drawn at a fixed spot inside the window; the *window* is
 * what moves around the virtual desktop. That keeps the always-on-top surface
 * tiny instead of covering a whole display.
 */
export function CompanionOverlay() {
  const state = useCompanion(useInitialAvatarId());

  if (state.status !== 'ready') {
    // A failed load must not paint anything: an error box on an always-on-top
    // transparent window would be stuck over the user's desktop.
    return null;
  }

  return <AnimatedCompanion runtime={state.runtime} />;
}

/** How far the pointer may travel and still count as a click, in CSS pixels. */
const CLICK_SLOP = 4;

/**
 * Split out so the subscriptions sit below the loading branch — hooks cannot be
 * called conditionally, and the runtime only exists once loaded.
 */
function AnimatedCompanion({ runtime }: { readonly runtime: CompanionRuntime }) {
  const animation = useAnimationState(runtime.player);
  const movement = useMovementState(runtime.movement);
  const bubbleText = useBubbleText(runtime);
  // The value is unused; subscribing re-renders when size or debug mode change.
  useSettingsRevision(runtime);
  const { manifest } = runtime.character;

  // The layout decides both the window size and where the character sits
  // inside it, so the character has to be offset to match.
  const layout = runtime.getLayout();

  // Tracked in a ref rather than state: it changes on every pointer move and
  // must not re-render the character.
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      // Capture so the drag keeps receiving events even though the window
      // moves out from under the cursor.
      event.currentTarget.setPointerCapture(event.pointerId);
      pressOrigin.current = { x: event.screenX, y: event.screenY };
      moved.current = false;

      // The event's own screen position, not the polled one: the cursor is
      // sampled at most a few times a second, so a stale sample would give a
      // wrong grab offset and make the character jump when picked up. On
      // macOS a CSS pixel is a logical point, which is the space the movement
      // layer works in.
      const cursor = { x: event.screenX, y: event.screenY };
      runtime.interaction.handlePointerDown(event.button, cursor, movement.position);
    },
    [runtime, movement.position],
  );

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = pressOrigin.current;
    if (!origin) return;
    if (
      Math.abs(event.screenX - origin.x) > CLICK_SLOP ||
      Math.abs(event.screenY - origin.y) > CLICK_SLOP
    ) {
      moved.current = true;
    }
  }, []);

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.currentTarget.releasePointerCapture(event.pointerId);
      pressOrigin.current = null;
      runtime.interaction.handlePointerUp(moved.current);
    },
    [runtime],
  );

  // The overlay has no menu of its own yet; suppress the webview's.
  const handleContextMenu = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  if (!runtime.isAvatarVisible) return null;
  const visiting = runtime.isReminderVisitMode;
  const visit = runtime.reminderVisit;
  const width = manifest.frameSize.width * runtime.getRenderScale();
  const height = manifest.frameSize.height * runtime.getRenderScale();

  return (
    <div className="overlay">
      {bubbleText === null ? null : (
        <SpeechBubble text={bubbleText} layout={layout} visible />
      )}
      <div
        className="overlay__character"
        style={{
          left: layout.characterOffset.x,
          top: layout.characterOffset.y,
          width,
          height,
          overflow: visiting ? 'hidden' : undefined,
          pointerEvents: visiting ? 'none' : undefined,
        }}
      >
        <div style={{
          width,
          height,
          transform: visiting
            ? `translateX(${visit.offset * width}px) rotate(${visit.stage === 'peek' ? (visit.side === 'left' ? 10 : -10) : 0}deg)`
            : undefined,
          transformOrigin: 'center bottom',
        }}>
        <CharacterRenderer
          manifest={manifest}
          frameUrl={animation.frameUrl}
          direction={movement.direction}
          scale={runtime.getRenderScale()}
          debug={runtime.isDebug()}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onContextMenu={handleContextMenu}
        />
        </div>
      </div>
    </div>
  );
}
