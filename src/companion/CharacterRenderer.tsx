import { memo, type PointerEvent as ReactPointerEvent } from 'react';
import type { CharacterManifest } from '@/types/character';

export interface CharacterRendererProps {
  readonly manifest: CharacterManifest;
  /** URL of the frame to display, driven by the animation engine. */
  readonly frameUrl: string;
  readonly direction: 'left' | 'right';
  readonly scale: number;
  /** Draws the hitbox and frame bounds; wired to the debug setting later. */
  readonly debug?: boolean;
  readonly onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onPointerUp?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onPointerMove?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onContextMenu?: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

/**
 * Draws a single character frame. It is deliberately dumb: it owns no timers
 * and no state, so the animation engine can stay independent of React.
 *
 * `memo` matters here — the overlay re-renders on every frame advance and only
 * the frame URL actually changes.
 */
export const CharacterRenderer = memo(function CharacterRenderer({
  manifest,
  frameUrl,
  direction,
  scale,
  debug = false,
  onPointerDown,
  onPointerUp,
  onPointerMove,
  onContextMenu,
}: CharacterRendererProps) {
  const width = manifest.frameSize.width * scale;
  const height = manifest.frameSize.height * scale;
  // Artwork is authored facing one way; the other direction is a mirror.
  const mirrored = direction !== manifest.facing;
  const hitbox = manifest.hitbox;

  return (
    <div className="character" style={{ width, height }}>
      <img
        className="character__frame"
        src={frameUrl}
        alt=""
        draggable={false}
        width={width}
        height={height}
        style={{ transform: mirrored ? 'scaleX(-1)' : undefined }}
      />
      {/*
        Pointer events are bound to the hitbox, not the whole frame, so the
        transparent padding around the character never swallows a click. The
        window itself is click-through except while the cursor is over this
        same rectangle.
      */}
      <div
        className="character__hitbox"
        data-debug={debug ? 'true' : undefined}
        style={{
          left: `${hitbox.x * 100}%`,
          top: `${hitbox.y * 100}%`,
          width: `${hitbox.width * 100}%`,
          height: `${hitbox.height * 100}%`,
        }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerMove={onPointerMove}
        onContextMenu={onContextMenu}
      />
    </div>
  );
});
