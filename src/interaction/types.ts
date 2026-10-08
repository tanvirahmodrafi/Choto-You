import type { Vector2 } from '@/movement/types';

export interface InteractionConfig {
  /** Master switch for every mouse reaction. */
  readonly enabled: boolean;
  readonly reactToClick: boolean;
  readonly reactToDoubleClick: boolean;
  readonly draggable: boolean;
  /** Face the cursor when it comes close. */
  readonly trackCursor: boolean;
  /** How near the cursor must be, in physical pixels, to be noticed. */
  readonly proximityRadius: number;
  /** Maximum gap between two clicks to count as a double click, in ms. */
  readonly doubleClickMs: number;
}

export const DEFAULT_INTERACTION_CONFIG: InteractionConfig = {
  enabled: true,
  reactToClick: true,
  reactToDoubleClick: true,
  draggable: true,
  trackCursor: true,
  proximityRadius: 220,
  doubleClickMs: 300,
};

export interface InteractionEvents {
  readonly onClick: () => void;
  readonly onDoubleClick: () => void;
  readonly onRightClick: (at: Vector2) => void;
  readonly onDragStart: () => void;
  readonly onDrag: (position: Vector2) => void;
  readonly onDragEnd: () => void;
  /** Fired when the cursor enters or leaves the proximity radius. */
  readonly onProximityChange: (near: boolean, cursor: Vector2 | null) => void;
  /** Every observed cursor position, used for idle detection. */
  readonly onCursorMoved: (cursor: Vector2) => void;
}
