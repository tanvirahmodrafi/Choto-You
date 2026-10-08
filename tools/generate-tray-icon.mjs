/**
 * Renders the menu bar icon.
 *
 * macOS template images use only the alpha channel — colour is discarded and
 * the shape is filled with whatever tint matches the menu bar. So this writes
 * the character's *silhouette*: black pixels where the character is, fully
 * transparent everywhere else. Reusing the app icon here would produce a solid
 * rounded rectangle, because that icon's alpha is its background plate.
 *
 * Run with: npm run assets:tray
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './png.mjs';
import { pose, render } from './character-art.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// 44px is a 22pt menu bar icon at 2x, the size macOS expects.
const SIZE = 44;

const character = render(pose({ bulb: 1 }), SIZE);

const out = Buffer.alloc(SIZE * SIZE * 4);
for (let i = 0; i < SIZE * SIZE; i++) {
  const alpha = character[i * 4 + 3] ?? 0;
  // Black, with the character's own coverage as the mask.
  out[i * 4] = 0;
  out[i * 4 + 1] = 0;
  out[i * 4 + 2] = 0;
  out[i * 4 + 3] = alpha;
}

mkdirSync(join(ROOT, 'src-tauri', 'icons'), { recursive: true });
const dest = join(ROOT, 'src-tauri', 'icons', 'tray.png');
writeFileSync(dest, encodePng(SIZE, SIZE, out));
console.log(`Wrote ${dest}`);
