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
        <span className="bubble__tail" style={{ left: layout.tailX }} aria-hidden="true" />
      </div>
    </div>
  );
});
