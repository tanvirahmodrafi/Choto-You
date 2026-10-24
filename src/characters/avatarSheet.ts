import type { AnimationSlot } from './stills';

/**
 * The sprite-sheet layout an imported avatar uses.
 *
 * This is the contract between three things that must agree exactly: the prompt
 * handed to an image model, the slicer that cuts the returned picture up, and
 * the manifest written for the pack. Keeping the layout here as data means the
 * prompt cannot drift out of step with the slicer — change the plan and both
 * follow.
 *
 * A grid in a single image, rather than one generation per pose, because an
 * image model asked many separate times will produce many different-looking
 * people. Asking once keeps the character consistent, which matters far more
 * than any individual frame.
 */

/** Cells across and down. 8x4 at 4096x2048 is 512px per cell. */
export const SHEET_COLUMNS = 8;
export const SHEET_ROWS = 4;

/** The high-resolution canvas an image model is asked for. */
export const SHEET_WIDTH = 4096;
export const SHEET_HEIGHT = 2048;

/**
 * Roughly how tall the character should end up on screen, in logical points.
 *
 * Cells are far larger than this, so the pack's `defaultScale` is derived from
 * the real cell height to land near it. A 256px character drawn 1:1 would be
 * enormous next to the bundled ones.
 */
export const TARGET_CHARACTER_HEIGHT = 120;

/**
 * How the character is meant to sit inside its cell.
 *
 * As *fractions of the cell*, not pixels, because the canvas size asked for
 * above is the one thing image models reliably ignore: sheets come back at
 * whatever resolution the model works at, so a rule stated in pixels stops
 * applying the moment it resizes while a fraction survives.
 *
 * The numbers exist because a model told only to "leave a margin" fills the
 * frame. Observed consequence, measured on returned sheets: characters drawn
 * 105-120% of their cell height, so every row overflowed into the one below,
 * the slicer's least-bad cut went through the shoes, and the bottom row's feet
 * ran off the edge of the image entirely. A cut-off foot cannot be recovered
 * afterwards — the pixels were never drawn — so this has to be got right in
 * the prompt.
 */
export const CELL_LAYOUT = {
  /** Head to heel, as a fraction of the cell's height. */
  characterHeight: 0.75,
  /** The ceiling on that, including hair and anything raised overhead. */
  maxCharacterHeight: 0.8,
  /** Where the soles of planted feet sit, measured down from the cell's top. */
  baseline: 0.88,
  /** The widest pose, as a fraction of the cell's width. */
  maxCharacterWidth: 0.8,
  /** Clear space required on every side of every cell. */
  margin: 0.1,
} as const;

/** A row that animates: its cells are consecutive frames of one loop. */
interface SequenceRow {
  readonly kind: 'sequence';
  readonly slot: AnimationSlot;
  readonly label: string;
  /** Frames per second for the finished clip. */
  readonly fps: number;
  /** What the image model is told to draw, cell by cell. */
  readonly cells: readonly string[];
}

/**
 * A row of single poses, one animation each.
 *
 * The order of the cells is a wire format, not a preference: it is how a sheet's
 * cells are matched to animation slots, so changing it silently re-labels every
 * sheet anyone has already generated — a jump would be imported as the pose for
 * being picked up. Reword a cell freely; do not move one.
 */
interface PoseRow {
  readonly kind: 'poses';
  readonly label: string;
  readonly cells: readonly { readonly slot: AnimationSlot; readonly description: string }[];
}

export type SheetRow = SequenceRow | PoseRow;

/**
 * What each row of the sheet holds.
 *
 * The three animated rows are the ones that make an avatar feel alive — a still
 * picture slid across the screen does not. Eight frames give the looping
 * actions smoother motion while the larger cells preserve facial detail.
 */
export const SHEET_PLAN: readonly SheetRow[] = [
  {
    kind: 'sequence',
    slot: 'idle',
    label: 'Idle / breathing',
    fps: 6,
    cells: [
      'Relaxed standing, arms at sides, both feet planted, eyes open',
      'Beginning to inhale; shoulders rise slightly',
      'Chest gently expands',
      'Full inhale; shoulders at highest position',
      'Beginning to exhale; shoulders lower',
      'Returning to relaxed standing',
      'Relaxed stance, eyelids half-closed',
      'Gentle blink, eyes closed; seamlessly returns to frame 1',
    ],
  },
  {
    kind: 'sequence',
    slot: 'walk',
    label: 'Run cycle (jog / sprint)',
    fps: 8,
    cells: [
      'RIGHT CONTACT: Right foot lands ahead of the body, left leg extended backward. Left arm forward, right arm backward',
      'RIGHT COMPRESSION: Right knee bends under body weight. Left leg bends and begins recovering forward. Body lowers slightly',
      'RIGHT PUSH-OFF: Right leg extends backward, right heel lifts. Left knee swings forward and upward. Body rises',
      'AIRBORNE: Both feet completely above the baseline. LEFT knee leading forward, RIGHT leg trailing backward. Right arm forward, left arm backward',
      'LEFT CONTACT: Left foot lands ahead of the body, right leg extended backward. Right arm forward, left arm backward',
      'LEFT COMPRESSION: Left knee bends under body weight. Right leg bends and begins recovering forward. Body lowers slightly',
      'LEFT PUSH-OFF: Left leg extends backward, left heel lifts. Right knee swings forward and upward. Body rises',
      'AIRBORNE: Both feet completely above the baseline. RIGHT knee leading forward, LEFT leg trailing backward. Left arm forward, right arm backward',
    ],
  },
  {
    kind: 'sequence',
    slot: 'wave',
    label: 'Peeking / waving',
    fps: 6,
    cells: [
      'Curious peek, one hand curled beside cheek as if holding an invisible screen edge',
      'Still holding the imaginary edge; head tilted slightly',
      'Head upright, fingers relaxing, small smile',
      'Releasing the imaginary edge, palm opening beside head',
      'Friendly wave, palm tilted outward',
      'Hand waves back inward',
      'Hand returns toward cheek; fingers curling',
      'Returns to original peeking pose, matching frame 1',
    ],
  },
  {
    kind: 'poses',
    label: 'Special reactions',
    cells: [
      {
        slot: 'jump',
        description:
          'Excited hop: Both feet airborne, knees bent, arms raised, cheerful grin',
      },
      {
        slot: 'fall',
        description:
          'Released / falling: Body falling through air, arms spread for balance, startled face, feet dangling',
      },
      {
        slot: 'land',
        description:
          'Landing: Deep crouch, both feet planted, one hand near floor, bracing expression',
      },
      {
        slot: 'happy',
        description: 'Delighted: Both arms raised, big smile, happy eyes',
      },
      {
        slot: 'surprised',
        description:
          'Surprised: Wide eyes, raised eyebrows, hands near shoulders, mouth slightly open',
      },
      {
        slot: 'drink',
        description:
          'Drinking: Holding a plain glass of water to mouth, head slightly tilted backward',
      },
      {
        slot: 'dragged',
        description:
          'Picked up: Hanging in midair as though lifted from under the arms, feet dangling, arms relaxed, startled expression. Do not draw the lifting hand',
      },
      {
        slot: 'sleep',
        description:
          'Sleeping: Standing peacefully, closed eyes, tilted head, limp arms',
      },
    ],
  },
];

/**
 * The three poses that make up one event: the user picks the companion up,
 * lets go, and it lands.
 *
 * Named here so the prompt can ask for them as a sequence. They are not
 * adjacent in the row and must not be rearranged to make them so — the cell
 * order is how slots are assigned, including on sheets already generated.
 */
export const DRAG_SEQUENCE: readonly AnimationSlot[] = ['dragged', 'fall', 'land'];

/** Cells left to right, top to bottom — the order the slicer produces them in. */
export function sheetCellPlan(): readonly { readonly slot: AnimationSlot; readonly description: string }[] {
  const cells: { slot: AnimationSlot; description: string }[] = [];
  for (const row of SHEET_PLAN) {
    if (row.kind === 'sequence') {
      for (const description of row.cells) cells.push({ slot: row.slot, description });
    } else {
      for (const cell of row.cells) cells.push({ slot: cell.slot, description: cell.description });
    }
  }
  return cells;
}

/**
 * The background colour the model is asked for when it cannot do transparency.
 *
 * A saturated green no skin tone, hair colour or ordinary garment sits near, so
 * keying it out does not eat into the character. The importer removes it.
 */
export const CHROMA_KEY = '#00B140';
