import { memo } from 'react';
import type { OverlayLayout } from './OverlayLayout';

export interface SpeechBubbleProps {
  readonly text: string;
  readonly layout: OverlayLayout;
  /** Drives the open/close transition. */
  readonly visible: boolean;
}

/**
 * The companion's speech bubble.
 *
 * Positioning is decided by `OverlayLayout`, not here: which side it opens
 * towards and where its tail points depend on the window geometry and the
 * display edges. This component only draws what it is told.
 */
export const SpeechBubble = memo(function SpeechBubble({
  text,
  layout,
  visible,
}: SpeechBubbleProps) {
  const bubble = layout.bubble;
  if (!bubble) return null;

  return (
    <div
      className="bubble"
      data-visible={visible ? 'true' : 'false'}
      style={{
        left: bubble.x,
        top: bubble.y,
        width: layout.windowSize.width,
        height: layout.characterOffset.y,
      }}
      // The bubble grows from the character, so the transform origin follows
      // the tail rather than the box centre.
      role="status"
    >
      <div className="bubble__body" style={{ transformOrigin: `${layout.tailX}px 100%` }}>
        <p className="bubble__text">{text}</p>
        {/* Three dots stepping down to the character's head, the way a thought
            balloon connects to whoever is thinking. A solid tail had to be
            drawn as a rotated square whose borders lined up with the box;
            dots are independent of the box and read at any size. */}
        <span className="bubble__dots" style={{ left: layout.tailX }} aria-hidden="true">
          <span className="bubble__dot" />
          <span className="bubble__dot" />
          <span className="bubble__dot" />
        </span>
      </div>
    </div>
  );
});
