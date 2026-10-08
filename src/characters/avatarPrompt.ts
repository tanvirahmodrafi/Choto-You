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
- The character faces to the RIGHT (three-quarter view towards the right) in every cell.

REMINDER BEHAVIOUR — design the poses for this performance:
- The character is invisible between reminders. When one is due, they cautiously peek around a side edge of the display, with a raised hand posed as if holding that edge, then sneak towards the centre, deliver the message, and run away.
- Row 3 supplies the edge peek and greeting: use a curious expression and a raised near hand with gently curled fingers, suitable for gripping an imaginary vertical edge, opening into a friendly wave. The app adds the lean and clips the body at the display edge.
- Row 2 supplies the sneaking entrance AND the running escape. Draw a light, springy tiptoe stride with slightly bent knees, a subtle forward lean, bent elbows, and clear alternating feet. It must read as cautious movement at normal speed and a playful scurry at faster playback. Keep all eight frames one continuous cycle; do not split the row into separate actions.
- Row 1 is the calm, attentive pose used while standing at the centre. Keep the expression friendly and ready to speak.
- The app moves and mirrors the character, reveals them from behind the edge, and draws the message. Draw only the complete character in each cell: no screen, wall, door, physical edge, speech bubble, message text, motion trails, or scenery. Do not crop the peeking poses or draw the character travelling across the sheet.
- Preserve the exact cell order below. These are animation frames, not a storyboard of the whole reminder.

CONSISTENCY ACROSS CELLS — the character is animated by flipping between these cells, so:
- Exactly the same character, outfit, colours and drawing style in all ${SHEET_COLUMNS * SHEET_ROWS} cells.
- Exactly the same size in every cell. Do not zoom in or out between cells.
- Use the SAME horizontal baseline in every cell, near the bottom of the cell. Planted feet touch that line; lifted feet may rise for a stride, jump, or fall without shifting the character's framing.
- The body must be horizontally centred in its cell, and must fit inside it with a margin on all four sides.
- Only the pose changes between cells. Nothing else.

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
