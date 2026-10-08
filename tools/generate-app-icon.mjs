/**
 * Renders a 1024x1024 source icon: the placeholder character on a rounded
 * plate, so it stays readable at 16px. `npx tauri icon` expands this into the
 * platform icon set. Run with: npm run assets:icon
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './png.mjs';
import { pose, render } from './character-art.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 1024;
const PLATE = [31, 62, 72];

// 1. The rounded plate, anti-aliased from the same rounded-box distance field.
const out = Buffer.alloc(SIZE * SIZE * 4);
const radius = SIZE * 0.22;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const qx = Math.abs(x + 0.5 - SIZE / 2) - SIZE / 2 + radius;
    const qy = Math.abs(y + 0.5 - SIZE / 2) - SIZE / 2 + radius;
    const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
    const i = (y * SIZE + x) * 4;
    out[i] = PLATE[0];
    out[i + 1] = PLATE[1];
    out[i + 2] = PLATE[2];
    out[i + 3] = Math.round(255 * Math.min(1, Math.max(0, 0.5 - d)));
  }
}

// 2. The character, rendered at 80% scale and composited over the plate.
const charSize = Math.round(SIZE * 0.8);
const character = render(pose({ bulb: 1 }), charSize);
const offset = Math.round((SIZE - charSize) / 2);
for (let y = 0; y < charSize; y++) {
  for (let x = 0; x < charSize; x++) {
    const s = (y * charSize + x) * 4;
    const alpha = character[s + 3] / 255;
    if (alpha === 0) continue;
    const d = ((y + offset) * SIZE + (x + offset)) * 4;
    for (let c = 0; c < 3; c++) {
      out[d + c] = Math.round(character[s + c] * alpha + out[d + c] * (1 - alpha));
    }
    out[d + 3] = Math.max(out[d + 3], character[s + 3]);
  }
}

mkdirSync(join(ROOT, 'src-tauri', 'icons'), { recursive: true });
const dest = join(ROOT, 'src-tauri', 'icons', 'source.png');
writeFileSync(dest, encodePng(SIZE, SIZE, out));
console.log(`Wrote ${dest}`);
