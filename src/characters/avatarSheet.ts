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

/** A row of unrelated single poses, one animation each. */
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
      'standing relaxed, arms down at the sides, eyes open, weight even — this cell fixes where the head and feet sit, and the other seven repeat it exactly',
      'the same pose from the same spot, beginning a gentle breath in, shoulders rising slightly; the head does not move sideways',
      'mid-breath, chest lifted slightly while the feet stay planted',
      'top of the breath, a touch taller with the same calm expression',
      'relaxing from the breath, shoulders beginning to lower',
      'nearly back to the original relaxed standing pose',
      'the relaxed pose with eyelids halfway closed, beginning a blink',
      'the same relaxed pose with both eyes closed, completing the blink',
    ],
  },
  {
    kind: 'sequence',
    slot: 'walk',
    label: 'Run cycle (jog / sprint)',
    fps: 8,
    cells: [
      'CONTACT, RIGHT leg leading: the right foot strikes the ground in front of the body, knee slightly bent; the left leg is stretched far out behind with the toe trailing. Torso leaning forward, left arm driving forward and right arm back, both elbows bent to about a right angle, hands loosely closed. Alert, playful expression',
      'DOWN, right leg leading: the lowest point of the cycle. The right knee is deeply bent taking the whole weight, the body compressed over it; the left leg has swung through underneath with the knee bent and the heel tucked up near the backside. Arms beginning to reverse',
      'PASSING, right leg leading: the right leg straightens and pushes off the ground, heel lifting; the left knee drives forward past it, high in front. The body is rising, arms level at the sides',
      'UP, right leg leading: AIRBORNE — both feet clear of the ground and the body at its highest. The legs are scissored wide apart, the left knee high in front and the right leg extended fully back behind. Right arm forward, left arm back',
      'CONTACT, LEFT leg leading — cell 1 with the arms and legs swapped, facing the same way: the left foot strikes the ground in front, the right leg stretched far behind, right arm forward and left arm back',
      'DOWN, left leg leading — cell 2 with the arms and legs swapped: lowest point, the left knee deeply bent under the weight, the right leg swinging through with the heel tucked up near the backside',
      'PASSING, left leg leading — cell 3 with the arms and legs swapped: the left leg straightens and pushes off while the right knee drives forward past it, body rising',
      'UP, left leg leading — cell 4 with the arms and legs swapped: AIRBORNE, both feet off the ground at the highest point, legs scissored wide, right knee high in front and left leg extended back. This flows straight back into cell 1 to close the loop',
    ],
  },
  {
    kind: 'sequence',
    slot: 'wave',
    label: 'Edge-holding peek / friendly greeting',
    fps: 6,
    cells: [
      'curious peek pose: near hand raised beside the cheek, elbow bent, fingers gently curled as if holding an imaginary vertical screen edge, eyes glancing right; show the full body and no actual edge',
      'holding the same imaginary edge: near fingers still curled, head tipping slightly towards the right, curious raised eyebrows, body centred',
      'peeking a little more confidently: head upright, near hand still beside the cheek, fingers starting to relax, a small friendly smile',
      'releasing the imaginary edge into a greeting: near hand opening beside the head, palm visible, warm smile',
      'friendly wave: raised open palm tilted outward, elbow bent, same warm smile and full-body framing',
      'friendly wave returning: raised open palm tilted inward, feet and body staying aligned',
      'finishing the wave: near hand moving back beside the cheek, fingers beginning to curl, curious expression returning',
      'near hand gently curled around the imaginary edge again, matching the first peek pose for a seamless loop, no physical edge drawn',
    ],
  },
  {
    kind: 'poses',
    label: 'Single poses',
    cells: [
      {
        slot: 'jump',
        description: 'jumping upward: both feet off the ground, knees bent, arms lifted, excited expression',
      },
      {
        slot: 'fall',
        description: 'falling gently: feet below the body, arms spread for balance, alert expression',
      },
      {
        slot: 'land',
        description: 'landing in a shallow crouch: both feet planted, knees bent, hands out for balance',
      },
      {
        slot: 'happy',
        description: 'delighted: both arms raised, big smile, eyes happy and crinkled',
      },
      {
        slot: 'surprised',
        description:
          'startled: eyes wide open, eyebrows up, both hands raised near the shoulders, mouth a small open circle',
      },
      {
        slot: 'drink',
        description:
          'drinking: holding a plain glass of water up to the mouth with one hand, head tilted back slightly',
      },
      {
        slot: 'dragged',
        description: 'being gently picked up: feet dangling, arms loose, mildly surprised expression',
      },
      {
        slot: 'sleep',
        description:
          'asleep standing: eyes closed as two curved lines, head tipped to one side, arms limp, peaceful expression',
      },
    ],
  },
];

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
