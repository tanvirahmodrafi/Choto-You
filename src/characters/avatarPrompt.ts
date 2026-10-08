import {
  CHROMA_KEY,
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
 * The constraints here are the ones that actually decide whether the result is
 * usable: a fixed grid, a constant baseline, and the same character throughout.
 * Everything else is style.
 */
export interface PromptOptions {
  /** What the user wants the avatar called, used to address the character. */
  readonly name?: string;
  /** Anything extra the user wants, e.g. "wearing a red saree". */
  readonly extras?: string;
}

export function buildAvatarPrompt(options: PromptOptions = {}): string {
  const who = options.name?.trim() ? `the person in the photo ("${options.name.trim()}")` : 'the person in the photo';
  const cellWidth = Math.round(SHEET_WIDTH / SHEET_COLUMNS);
  const cellHeight = Math.round(SHEET_HEIGHT / SHEET_ROWS);

  const rows = SHEET_PLAN.map((row, index) => {
    const number = index + 1;
    if (row.kind === 'sequence') {
      const cells = row.cells
        .map((cell, cellIndex) => `   - Cell ${cellIndex + 1}: ${cell}`)
        .join('\n');
      return `Row ${number} — ${row.label} (these ${row.cells.length} cells play as a loop, so they must flow into each other):\n${cells}`;
    }
    const cells = row.cells
      .map((cell, cellIndex) => `   - Cell ${cellIndex + 1}: ${cell.description}`)
      .join('\n');
    return `Row ${number} — ${row.label} (${row.cells.length} unrelated poses):\n${cells}`;
  }).join('\n\n');

  return `I am making a small desktop companion character from the attached photo. Please generate ONE image: a sprite sheet of that person as a cute, simplified cartoon mascot.

OUTPUT FORMAT — this matters more than anything else:
- A single high-resolution PNG, exactly ${SHEET_WIDTH}x${SHEET_HEIGHT} pixels. Do not return a smaller preview.
- Laid out as an exact ${SHEET_COLUMNS}x${SHEET_ROWS} grid: ${SHEET_COLUMNS} columns, ${SHEET_ROWS} rows, ${SHEET_COLUMNS * SHEET_ROWS} cells of ${cellWidth}x${cellHeight} pixels each.
- Transparent background. If you cannot produce transparency, fill the background with flat ${CHROMA_KEY} green and nothing else.
- Do NOT draw a grey-and-white checkerboard. A checkerboard is how an editor *displays* transparency; drawing one produces a picture of a checkerboard, which is not transparent.
- Do NOT draw grid lines, borders, frames, labels, numbers, captions, watermarks, drop shadows or any ground/floor.
- Leave a clear gap between rows. No part of a character may touch or cross into the cell above or below it.

THE CHARACTER:
- A small, friendly, polished chibi-style cartoon version of ${who}: big head, small body, roughly 3 heads tall, smooth clean outlines, detailed facial features, and refined cel shading.
- Render crisp high-resolution edges and preserve recognisable facial and clothing details. Do not use pixel art, intentional blur, heavy texture, or compression artifacts.
- Keep them recognisable — hairstyle, hair colour, skin tone, facial hair, glasses, and clothing should match the photo. Keep the same outfit in every single cell.
- Full body in every cell, head to feet, nothing cropped.
- The character faces to the RIGHT in every cell: a three-quarter view towards the right for the standing, greeting and single-pose cells, and a near-side view for the run row (row 2) so both legs and both arms are visible and read apart.
- Both arms and both legs are drawn in every cell. Shade the limbs on the far side of the body slightly darker than the near ones so the two sides can be told apart.

ROW 2 IS A RUN CYCLE — this is the part that is most often got wrong:
- Draw it as a RUN, not a walk and not a tiptoe sneak: a strong forward lean of the whole torso, knees lifted high in front, the trailing heel kicked up towards the backside, elbows bent to about a right angle and driving hard, hands loosely closed.
- A run has an airborne phase. In cells 4 and 8 BOTH feet are off the ground at once and the body is at its highest. If every cell has a foot on the ground, the row is a walk and it is wrong.
- The eight cells are one complete two-step cycle of four phases each. Cells 1-4 are the step on the RIGHT leg; cells 5-8 are those same four drawings with the arms and legs swapped so the LEFT leg takes the step, facing the same direction as before. Over the loop each leg leads exactly once.
- The four phases, in order: CONTACT (the leading foot strikes the ground in front, the other leg stretched far behind), DOWN (lowest point, the supporting knee deeply bent taking the weight, the free leg swinging through with the heel tucked up near the backside), PASSING (the supporting leg straightening to push off while the free knee drives forward past it, body rising), UP (airborne, legs scissored wide apart, front knee high, rear leg extended back).
- Never draw the same leg forward in two neighbouring cells, and never repeat one pose eight times with only the arms or the expression changed. If cells 1 and 5 look alike, the row is wrong.
- Keep the two legs clearly separate in every cell — a visible gap between them, or one leg swinging past the other with the knee bent. Do not hide the far leg behind the near one.
- The character runs on the spot. Its body stays in the same place in every cell; do not move it across the row.

REMINDER BEHAVIOUR — design the poses for this performance:
- The character is invisible between reminders. When one is due, they cautiously peek around a side edge of the display, with a raised hand posed as if holding that edge, then hurry out to the centre, deliver the message, and run away.
- Row 3 supplies the edge peek and greeting: use a curious expression and a raised near hand with gently curled fingers, suitable for gripping an imaginary vertical edge, opening into a friendly wave. The app adds the lean and clips the body at the display edge.
- Row 2 supplies the entrance AND the escape, and is the character's ordinary travelling animation everywhere else. It must read as a jog at normal speed and a sprint when played faster, so draw a real run, as described above. Keep all eight frames as one continuous cycle; do not split the row into separate actions.
- Row 1 is the calm, attentive pose used while standing at the centre. Keep the expression friendly and ready to speak.
- The app moves and mirrors the character, reveals them from behind the edge, and draws the message. Draw only the complete character in each cell: no screen, wall, door, physical edge, speech bubble, message text, motion trails, or scenery. Do not crop the peeking poses or draw the character travelling across the sheet.
- Preserve the exact cell order below. These are animation frames, not a storyboard of the whole reminder.

CONSISTENCY ACROSS CELLS — the character is animated by flipping between these cells, so:
- Exactly the same character, outfit, colours and drawing style in all ${SHEET_COLUMNS * SHEET_ROWS} cells.
- Exactly the same size in every cell. Do not zoom in or out between cells.
- Only the pose changes between cells. Nothing else.

REGISTRATION — where the character sits inside its cell. Rows 1, 2 and 3 are played as loops, so any drift here becomes the character visibly sliding sideways on screen and snapping back:
- Put the centre of the head on the exact centre line of the cell, in EVERY cell of the sheet. Same spot, cell after cell. The arms and legs swing around it; the head and torso do not travel.
- Imagine the same cross drawn in the middle of every cell before you start, and hang the character on it each time. Do not re-compose, re-centre or re-frame a pose to make it look better on its own — the cells are only ever seen one after another, never side by side.
- Use the SAME horizontal baseline in every cell, near the bottom. Planted feet touch that line; lifted feet may rise for a stride, jump or fall without shifting the character's framing.
- Leave a clear margin on all four sides of every cell: nothing may touch or cross a cell edge, not even at the widest point of a stride or the tips of outstretched arms. Choose the character's size so that the WIDEST cell still fits with room to spare. The calmer cells will then sit in more empty space, which is correct and expected — do not enlarge them to fill it.

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
