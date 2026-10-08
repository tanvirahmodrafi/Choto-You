/**
 * Writes a sample sprite sheet in exactly the layout the avatar importer
 * expects, so the import flow can be tried without a round trip to an image
 * model.
 *
 * Uses the same original procedural character as the bundled avatars, drawn on
 * the flat chroma-green the prompt asks for when transparency is unavailable —
 * which also exercises the importer's background removal.
 *
 * Run with: npm run assets:sample-sheet
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './png.mjs';
import { ANIMATIONS, FRAME_SIZE, pose, render, usePalette } from './character-art.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'samples');

const COLUMNS = 8;
const ROWS = 4;
const CELL = 512;
const WIDTH = CELL * COLUMNS;
const HEIGHT = CELL * ROWS;

/** Matches CHROMA_KEY in src/characters/avatarSheet.ts. */
const BACKGROUND = [0x00, 0xb1, 0x40];

/**
 * Which pose goes in each cell, in grid order.
 *
 * Mirrors SHEET_PLAN: eight idle frames, an eight-frame walk cycle, eight
 * waving frames, then eight single poses. Frames are picked across each
 * animation so the cycle reads as a cycle rather than near-identical pictures.
 */
const CELLS = [
  ...pick('idle', 8),
  ...pick('walk', 8),
  ...pick('wave', 8),
  ...pick('jump', 1),
  ...pick('fall', 1),
  ...pick('land', 1),
  ...pick('happy', 1),
  ...pick('surprised', 1),
  ...pick('drink', 1),
  ...pick('dragged', 1),
  ...pick('sleep', 1),
];

/** Evenly spaced frames from one animation. */
function pick(name, count) {
  const animation = ANIMATIONS[name];
  if (!animation) throw new Error(`No animation "${name}"`);
  return Array.from({ length: count }, (_, i) => {
    const index = Math.round((i * animation.frames) / count) % animation.frames;
    return { name, index, total: animation.frames };
  });
}

usePalette('pip');

// The sheet starts as solid background; each cell is composited over it.
const sheet = Buffer.alloc(WIDTH * HEIGHT * 4);
for (let i = 0; i < WIDTH * HEIGHT; i++) {
  sheet[i * 4] = BACKGROUND[0];
  sheet[i * 4 + 1] = BACKGROUND[1];
  sheet[i * 4 + 2] = BACKGROUND[2];
  sheet[i * 4 + 3] = 255;
}

CELLS.forEach((cell, index) => {
  const animation = ANIMATIONS[cell.name];
  const t = cell.index / cell.total;
  // Rendered at the cell size directly: `render` scales the signed-distance
  // field, so this is a clean 512px drawing rather than an upscaled 96px one.
  const rgba = render(pose(animation.pose(t, cell.index)), CELL);

  const column = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  const originX = column * CELL;
  const originY = row * CELL;

  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const from = (y * CELL + x) * 4;
      const alpha = rgba[from + 3] / 255;
      if (alpha === 0) continue;
      const to = ((originY + y) * WIDTH + (originX + x)) * 4;
      // Source-over, so anti-aliased edges blend into the background exactly as
      // an image model's output would.
      for (let channel = 0; channel < 3; channel++) {
        sheet[to + channel] = Math.round(
          rgba[from + channel] * alpha + sheet[to + channel] * (1 - alpha),
        );
      }
      sheet[to + 3] = 255;
    }
  }
});

mkdirSync(OUT, { recursive: true });
const file = join(OUT, 'sample-avatar-sheet.png');
writeFileSync(file, encodePng(WIDTH, HEIGHT, sheet));
console.log(`Wrote a ${WIDTH}x${HEIGHT} ${COLUMNS}x${ROWS} sheet (${CELL}px cells) to ${file}`);
