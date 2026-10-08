/**
 * Renders the menu bar icon from the bundled avatar's standing pose.
 *
 * macOS template images use only the alpha channel — colour is discarded and
 * the shape is filled with whatever tint matches the menu bar. So this writes
 * the character's *silhouette*: black pixels where the character is, fully
 * transparent everywhere else. Reusing the app icon here would produce a solid
 * disc, because that icon's alpha is its sticker outline.
 *
 * The shape is taken from the avatar rather than drawn separately, so the thing
 * in the menu bar is the same character that is standing on the desktop.
 *
 * Run with: npm run assets:tray (after npm run assets:character)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSE = join(ROOT, 'public', 'characters', 'rafi', 'idle', '001.png');
// 44px is a 22pt menu bar icon at 2x, the size macOS expects.
const SIZE = 44;
/** Alpha above which the artwork counts as part of the silhouette. */
const SOLID = 96;

const frame = decodePng(readFileSync(POSE));
const box = silhouetteBox(frame);

// Fitted to the taller side and centred, so the character keeps its proportions
// and is not stretched into the square.
const scale = SIZE / Math.max(box.width, box.height);
const out = Buffer.alloc(SIZE * SIZE * 4);
const offsetX = (SIZE - box.width * scale) / 2;
const offsetY = (SIZE - box.height * scale) / 2;

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    // Each output pixel averages the artwork that falls inside it, which is
    // what keeps a thin arm or a leg from disappearing at this size.
    const left = box.left + (x - offsetX) / scale;
    const top = box.top + (y - offsetY) / scale;
    const right = left + 1 / scale;
    const bottom = top + 1 / scale;

    let total = 0;
    let samples = 0;
    for (let sourceY = Math.floor(top); sourceY < Math.ceil(bottom); sourceY++) {
      for (let sourceX = Math.floor(left); sourceX < Math.ceil(right); sourceX++) {
        if (sourceX < 0 || sourceY < 0 || sourceX >= frame.width || sourceY >= frame.height) {
          samples += 1;
          continue;
        }
        total += frame.rgba[(sourceY * frame.width + sourceX) * 4 + 3];
        samples += 1;
      }
    }

    const index = (y * SIZE + x) * 4;
    // Black, with the character's own coverage as the mask.
    out[index] = 0;
    out[index + 1] = 0;
    out[index + 2] = 0;
    out[index + 3] = samples === 0 ? 0 : Math.round(total / samples);
  }
}

mkdirSync(join(ROOT, 'src-tauri', 'icons'), { recursive: true });
writeFileSync(join(ROOT, 'src-tauri', 'icons', 'tray.png'), encodePng(SIZE, SIZE, out));
console.log(`Wrote src-tauri/icons/tray.png (${SIZE}x${SIZE}) from the bundled avatar.`);

/** The character's own bounds inside its frame, ignoring soft edges. */
function silhouetteBox(image) {
  let left = image.width;
  let right = -1;
  let top = image.height;
  let bottom = -1;

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.rgba[(y * image.width + x) * 4 + 3] < SOLID) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < left || bottom < top) throw new Error('The standing pose is empty.');
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}
