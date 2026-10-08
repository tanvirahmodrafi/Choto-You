import {
  CELL_LAYOUT,
  CHROMA_KEY,
  DRAG_SEQUENCE,
  SHEET_COLUMNS,
  SHEET_HEIGHT,
  SHEET_PLAN,
  SHEET_ROWS,
  SHEET_WIDTH,
} from './avatarSheet';

/**
 * Builds the prompt the user hands to an image model along with a photo.
 *
 * Generated from `SHEET_PLAN` rather than written out by hand, so the pose list
 * in the prompt and the one the slicer expects can never disagree — which would
 * silently produce an avatar whose walk frames were its waving frames.
 *
 * Every rule here is one that was observed failing. Each is stated once, in the
 * section it belongs to: a prompt that says the same thing four times in four
 * places reads as emphasis to a person and as noise to a model, and it buries
 * the measurements that actually decide whether the sheet can be cut up.
 */
export interface PromptOptions {
  /** What the user wants the avatar called, used to address the character. */
  readonly name?: string;
  /** Anything extra the user wants, e.g. "wearing a red saree". */
  readonly extras?: string;
}

export function buildAvatarPrompt(options: PromptOptions = {}): string {
  const who = options.name?.trim()
    ? `the person in the attached photo ("${options.name.trim()}")`
    : 'the person in the attached photo';
  const cellWidth = Math.round(SHEET_WIDTH / SHEET_COLUMNS);
  const cellHeight = Math.round(SHEET_HEIGHT / SHEET_ROWS);

  // Every measurement is given as a percentage and as pixels. The percentage is
  // the rule — it still holds when the model returns a different canvas size,
  // which is the usual outcome — and the pixels make it concrete.
  const percent = (fraction: number): string => `${Math.round(fraction * 100)}%`;
  const down = (fraction: number): number => Math.round(cellHeight * fraction);
  const across = (fraction: number): number => Math.round(cellWidth * fraction);

  const poseRow = SHEET_PLAN.findIndex((row) => row.kind === 'poses');
  const poses = SHEET_PLAN[poseRow];
  const dragCells =
    poses?.kind === 'poses'
      ? DRAG_SEQUENCE.map((slot) => poses.cells.findIndex((cell) => cell.slot === slot) + 1)
      : [];

  const rows = SHEET_PLAN.map((row, index) => {
    const cells =
      row.kind === 'sequence'
        ? row.cells.map((cell, position) => `   ${position + 1}. ${cell}`)
        : row.cells.map((cell, position) => {
            // The three pick-up moments are marked where they are drawn as
            // well as named above, because they are not next to each other and
            // a model reading the list alone would treat them as unrelated.
            const moment = DRAG_SEQUENCE.indexOf(cell.slot);
            const tag =
              moment >= 0 ? ` [moment ${moment + 1} of 3 of the pick-up sequence]` : '';
            return `   ${position + 1}. ${cell.description}${tag}`;
          });
    const kind =
      row.kind === 'sequence'
        ? `${row.cells.length} frames of one loop, in order`
        : `${row.cells.length} separate poses, each held on its own`;
    return `Row ${index + 1} — ${row.label} (${kind}):\n${cells.join('\n')}`;
  }).join('\n\n');

  return `I am making a small desktop companion character. Please turn the attached photo into ONE image: a sprite sheet of that person as a cute cartoon mascot.

THE PHOTO IS OF A REAL PERSON — the whole point is that the result looks like them:
- Build the face from the photo: the shape of the face and jaw, the nose, the shape and spacing of the eyes, the eyebrows, the mouth, the ears, the skin tone.
- Keep the hair exactly — length, style, parting, colour, texture — and keep glasses, facial hair, a mole, a piercing, anything distinctive.
- Keep their apparent age, their gender presentation, their ethnicity and their build. Do not slim them, lighten their skin, straighten their hair, remove their glasses or otherwise "improve" them.
- Simplify the STYLE, never the identity. Someone who knows ${who} should recognise them in a 64-pixel icon, which only happens if the structure of the face is right — hair and clothes alone are not enough.
- Keep the same face, hair, outfit and colours in all ${SHEET_COLUMNS * SHEET_ROWS} cells. Only the pose changes.

STYLE:
- A friendly chibi mascot: big head, small body, roughly 3 heads tall, clean smooth outlines, soft cel shading, crisp high-resolution edges. Not pixel art, not blurry, not heavily textured.
- Facing RIGHT in every cell — a three-quarter view towards the right, except the run row, which is a near-side view so both legs read clearly.
- Both arms and both legs visible in every cell, with the limbs on the far side of the body shaded slightly darker so the two sides can be told apart.

OUTPUT FORMAT:
- A single PNG, exactly ${SHEET_WIDTH}x${SHEET_HEIGHT} pixels. Do not return a smaller preview.
- An exact ${SHEET_COLUMNS}x${SHEET_ROWS} grid: ${SHEET_COLUMNS} columns, ${SHEET_ROWS} rows, ${SHEET_COLUMNS * SHEET_ROWS} cells of ${cellWidth}x${cellHeight} pixels each.
- Transparent background. If you cannot do transparency, fill it with flat ${CHROMA_KEY} green and nothing else. Do NOT draw a grey-and-white checkerboard: that is how an editor *shows* transparency, and drawing one produces a picture of a checkerboard.
- Nothing in the image but the character: no grid lines, borders, frames, labels, numbers, captions, watermarks, drop shadows, ground, floor, scenery, props beyond those named below, speech bubbles or motion trails.

SIZE AND POSITION INSIDE EACH CELL — the most common way this goes wrong, so please measure it:
- DRAW THE CHARACTER SMALL INSIDE ITS CELL. Head to heel is ${percent(CELL_LAYOUT.characterHeight)} of the cell's height — about ${down(CELL_LAYOUT.characterHeight)}px of a ${cellHeight}px cell — and never more than ${percent(CELL_LAYOUT.maxCharacterHeight)}, measured from the top of the hair to the sole of the lowest foot.
- The soles of planted feet rest on one horizontal line ${percent(CELL_LAYOUT.baseline)} of the way down the cell, about ${down(CELL_LAYOUT.baseline)}px from its top edge, leaving ${down(1 - CELL_LAYOUT.baseline)}px below. The same line in every cell of the sheet.
- The widest pose — arms out, legs scissored mid-stride — is at most ${percent(CELL_LAYOUT.maxCharacterWidth)} of the cell's width, about ${across(CELL_LAYOUT.maxCharacterWidth)}px of ${cellWidth}px.
- Keep at least ${percent(CELL_LAYOUT.margin)} of the cell — about ${across(CELL_LAYOUT.margin)}px — completely empty on all four sides. Nothing may touch or cross a cell edge: not hair, not a raised hand, not a trailing foot.
- Those margins are not decoration. The app cuts the sheet apart along the cell edges, so anything crossing one is destroyed. In practice that means the feet: a figure drawn too tall overflows the bottom of its cell and its shoes are either sliced off or collide with the head of the row below.
- Pick ONE size that satisfies this for the tallest pose (arms raised) and the widest pose (mid-stride), then draw all ${SHEET_COLUMNS * SHEET_ROWS} cells at that size. Never zoom in or out between cells. The calm standing cells will sit in noticeably more empty space — that is correct, do NOT enlarge them to fill the cell.

REGISTRATION — rows 1 to 3 are played as loops, so drift here becomes the character visibly sliding sideways on screen and snapping back:
- Put the centre of the head on the cell's exact vertical centre line, in every cell. The arms and legs swing around it; the head and torso do not travel.
- Imagine the same cross in every cell before you start — that centre line, and the baseline ${percent(CELL_LAYOUT.baseline)} of the way down — and hang the character on it each time. Do not re-compose or re-centre a pose to make it look better on its own: these cells are only ever seen one after another, never side by side.
- Planted feet touch the baseline exactly. Feet may rise above it for a stride, a jump or a fall. Nothing ever goes below it.

ROW 2 IS A RUN CYCLE — the part most often got wrong:
- A real RUN, not a walk and not a tiptoe sneak: strong forward lean, knees lifted high in front, the trailing heel kicked up towards the backside, elbows bent to about a right angle and driving hard, hands loosely closed.
- A run has an airborne phase. In cells 4 and 8 BOTH feet are off the ground and the body is at its highest. If every cell has a foot down, it is a walk and it is wrong.
- Cells 5 to 8 are cells 1 to 4 with the arms and legs swapped — NOT mirrored. The character still faces right. Over the loop each leg leads exactly once, and the same leg never leads in two neighbouring cells. If cells 1 and 5 look alike, the row is wrong.
- Keep the legs clearly separate in every cell: a visible gap, or one swinging past the other with the knee bent. Never hide the far leg behind the near one.
- The character runs on the spot. Do not move it across the row.

WHAT THE ROWS ARE FOR — this is how the app uses them, so draw for it:
- Row 1 is the calm standing loop, used while the character is idle and while it speaks.
- Row 2 carries it everywhere: it must read as a jog at normal speed and a sprint when played faster. One continuous cycle; do not split the row into separate actions.
- Row 3 is the entrance. The character peeks around the side edge of the display, holding that edge, then opens into a greeting. Draw the full body and no edge of any kind — the app clips it against the screen edge itself. One continuous loop.
- Row 4 is eight separate poses.${
    dragCells.length === 3
      ? `\n- In row 4, cells ${dragCells[0]}, ${dragCells[1]} and ${dragCells[2]} are three moments of ONE event, in that order: the user picks the character up by hand, lets go of it, and it lands. Draw them as a sequence that belongs together — the same startled face carried through from being lifted, into the drop, into bracing against the floor.`
      : ''
  }
- The other five poses in row 4 are reactions the character performs on the spot. Keep them one family rather than five unrelated drawings: the same framing and the same level of exaggeration throughout, reading as one person in five moods — cheerful in the hop and the delighted pose, the same face startled, then calm for drinking and for dozing off.

THE CELLS, left to right, top to bottom:

${rows}${options.extras?.trim() ? `\n\nALSO: ${options.extras.trim()}` : ''}

Please return the finished PNG as a downloadable file.`;
}

/**
 * A short reminder of what to do with the result, shown beside the button.
 *
 * Kept next to the prompt so the two are edited together.
 */
export const PROMPT_STEPS: readonly string[] = [
  'Copy the prompt below.',
  'Open ChatGPT or Claude, attach a clear, well-lit photo of the person, and paste the prompt.',
  'Download the PNG it gives you back.',
  'Choose that file here. The poses are cut out of it automatically.',
];
