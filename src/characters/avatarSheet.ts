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
    label: 'Standing',
    fps: 6,
    cells: [
      'standing relaxed, arms at the sides, weight even on both feet, eyes open, calm friendly expression. This cell sets the pose the other seven return to',
      'the same pose, beginning to breathe in, shoulders rising slightly',
      'mid-breath, the chest lifted a little',
      'top of the breath, a touch taller, same calm expression',
      'breathing out, shoulders beginning to lower',
      'almost back to the relaxed pose',
      'the relaxed pose with the eyelids halfway down, starting to blink',
      'the relaxed pose with both eyes closed, finishing the blink',
    ],
  },
  {
    kind: 'sequence',
    slot: 'walk',
    label: 'Run cycle (jog / sprint)',
    fps: 8,
    cells: [
      'CONTACT, RIGHT leg leading: the right foot strikes the ground in front, knee slightly bent; the left leg stretched far out behind, toe trailing. Torso leaning forward, left arm driving forward and right arm back, elbows bent to about a right angle, hands loosely closed',
      'DOWN, right leg leading — the lowest point: the right knee deeply bent under the whole weight, body compressed over it; the left leg swung through underneath, knee bent, heel tucked up near the backside. Arms beginning to reverse',
      'PASSING, right leg leading: the right leg straightening to push off, heel lifting, while the left knee drives forward past it, high in front. Body rising, arms level at the sides',
      'UP, right leg leading — AIRBORNE, both feet clear of the ground, body at its highest: legs scissored wide apart, left knee high in front, right leg extended fully back. Right arm forward, left arm back',
      'CONTACT, LEFT leg leading: cell 1 with the arms and legs swapped',
      'DOWN, left leg leading: cell 2 with the arms and legs swapped',
      'PASSING, left leg leading: cell 3 with the arms and legs swapped',
      'UP, left leg leading: cell 4 with the arms and legs swapped, flowing straight back into cell 1 to close the loop',
    ],
  },
  {
    kind: 'sequence',
    slot: 'wave',
    label: 'Edge-holding peek / friendly greeting',
    fps: 6,
    cells: [
      'peeking: the near hand raised beside the cheek, elbow bent, fingers gently curled as if gripping an imaginary vertical edge, eyes glancing right, curious expression',
      'still holding that imaginary edge, head tipped slightly to the right, eyebrows raised',
      'more confident: head upright, hand still beside the cheek, fingers starting to relax, a small friendly smile',
      'releasing the edge into a greeting: the hand opening beside the head, palm visible, warm smile',
      'waving, open palm tilted outward, elbow bent',
      'waving back the other way, open palm tilted inward',
      'finishing the wave: the hand returning beside the cheek, fingers beginning to curl again',
      'the hand curled around the imaginary edge once more, matching cell 1 so the loop closes',
    ],
  },
  {
    kind: 'poses',
    label: 'Reactions, and the pick-up sequence',
    cells: [
      {
        slot: 'jump',
        description:
          'hopping on the spot with excitement: both feet off the ground, knees bent up underneath, both arms lifted, big grin',
      },
      {
        slot: 'fall',
        description:
          'JUST RELEASED, dropping: the body upright but tilted slightly back, both arms up and out for balance, legs loose and trailing, hair and clothing pushed upwards by the air, eyes wide',
      },
      {
        slot: 'land',
        description:
          'LANDING, absorbing the impact: a deep crouch with both feet planted, knees bent out to the sides, the body compressed down over them, one hand reaching to the floor for balance and the other out to the side, bracing expression',
      },
      {
        slot: 'happy',
        description: 'delighted: both arms raised, big smile, eyes crinkled',
      },
      {
        slot: 'surprised',
        description:
          'startled: eyes wide open, eyebrows up, both hands raised near the shoulders, mouth a small open circle',
      },
      {
        slot: 'drink',
        description:
          'drinking: a plain glass of water held up to the mouth in one hand, head tipped back slightly, content expression',
      },
      {
        slot: 'dragged',
        description:
          'PICKED UP and held in the air: the body hanging as if lifted from under the arms, feet dangling clear of the ground, arms loose, head turned up, startled but trusting expression. Draw nothing doing the lifting — no hand, string or hook',
      },
      {
        slot: 'sleep',
        description:
          'asleep on their feet: eyes closed as two curved lines, head tipped to one side, arms limp, peaceful expression',
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
