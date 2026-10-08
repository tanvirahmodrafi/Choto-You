/**
 * Builds the figures the README shows, from the bundled avatar pack and the
 * artwork in `art/`.
 *
 * Everything here is a view of an asset that already exists: pose strips, the
 * three looping animations as GIFs, and smaller copies of the app icon and the
 * source sprite sheet. Nothing is drawn by hand, so re-running this after the
 * avatar changes keeps the README showing the character that actually ships.
 *
 * Run with: npm run assets:readme
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.mjs';
import { encodeGif } from './gif.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs/images');

function load(path) {
  const image = decodePng(readFileSync(join(root, path)));
  return { width: image.width, height: image.height, data: image.rgba };
}

/**
 * Box-filter downscale. Colour is averaged with alpha weighting and then
 * un-premultiplied, so the transparent margin around a sprite cannot bleed its
 * (arbitrary) colour into the outline.
 */
function resize(source, width, height) {
  const data = new Uint8Array(width * height * 4);
  const scaleX = source.width / width;
  const scaleY = source.height / height;

  for (let y = 0; y < height; y++) {
    const top = Math.floor(y * scaleY);
    const bottom = Math.max(top + 1, Math.floor((y + 1) * scaleY));
    for (let x = 0; x < width; x++) {
      const left = Math.floor(x * scaleX);
      const right = Math.max(left + 1, Math.floor((x + 1) * scaleX));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = top; sy < bottom; sy++) {
        for (let sx = left; sx < right; sx++) {
          const i = (sy * source.width + sx) * 4;
          const alpha = source.data[i + 3] / 255;
          r += source.data[i] * alpha;
          g += source.data[i + 1] * alpha;
          b += source.data[i + 2] * alpha;
          a += source.data[i + 3];
          count++;
        }
      }

      const alpha = a / count;
      const unpremultiply = alpha > 0 ? 255 / alpha : 0;
      const target = (y * width + x) * 4;
      data[target] = Math.min(255, Math.round((r / count) * unpremultiply));
      data[target + 1] = Math.min(255, Math.round((g / count) * unpremultiply));
      data[target + 2] = Math.min(255, Math.round((b / count) * unpremultiply));
      data[target + 3] = Math.round(alpha);
    }
  }

  return { width, height, data };
}

function blit(target, source, offsetX, offsetY) {
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const s = (y * source.width + x) * 4;
      const alpha = source.data[s + 3];
      if (alpha === 0) continue;
      const d = ((offsetY + y) * target.width + offsetX + x) * 4;
      target.data[d] = source.data[s];
      target.data[d + 1] = source.data[s + 1];
      target.data[d + 2] = source.data[s + 2];
      target.data[d + 3] = alpha;
    }
  }
}

/** One row of frames on a transparent background. */
function strip(paths, cell, gap) {
  const width = paths.length * cell + (paths.length - 1) * gap;
  const canvas = { width, height: cell, data: new Uint8Array(width * cell * 4) };
  paths.forEach((path, index) => {
    blit(canvas, resize(load(path), cell, cell), index * (cell + gap), 0);
  });
  return canvas;
}

function writePng(name, image) {
  const buffer = encodePng(image.width, image.height, Buffer.from(image.data));
  writeFileSync(join(out, name), buffer);
  console.log(`${name}  ${image.width}x${image.height}  ${(buffer.length / 1024).toFixed(0)}KB`);
}

function writeGif(name, paths, size, fps) {
  const frames = paths.map((path) => ({
    rgba: resize(load(path), size, size).data,
    delayMs: 1000 / fps,
  }));
  const buffer = encodeGif(size, size, frames);
  writeFileSync(join(out, name), buffer);
  console.log(`${name}  ${size}x${size}  ${frames.length} frames  ${(buffer.length / 1024).toFixed(0)}KB`);
}

const frames = (animation, count) =>
  Array.from(
    { length: count },
    (_, index) => `public/characters/rafi/${animation}/${String(index + 1).padStart(3, '0')}.png`,
  );

mkdirSync(out, { recursive: true });

writePng(
  'poses.png',
  strip(
    [
      'public/characters/rafi/idle/001.png',
      'public/characters/rafi/walk/004.png',
      'public/characters/rafi/wave/005.png',
      'public/characters/rafi/happy/001.png',
      'public/characters/rafi/surprised/001.png',
      'public/characters/rafi/drink/001.png',
      'public/characters/rafi/dragged/001.png',
      'public/characters/rafi/sleep/001.png',
    ],
    150,
    10,
  ),
);
writePng('walk-cycle.png', strip(frames('walk', 8), 110, 6));
writePng('app-icon.png', resize(load('art/app-icon.png'), 256, 256));
writePng('thumbnail.png', resize(load('public/characters/rafi/thumbnail.png'), 96, 96));

const sheet = load('art/avatar-sheet.png');
writePng('avatar-sheet.png', resize(sheet, 1000, Math.round((sheet.height / sheet.width) * 1000)));

// The fps here are the ones in `character.json`, so the README loops run at the
// speed the companion actually animates at.
writeGif('idle.gif', frames('idle', 8), 180, 6);
writeGif('walk.gif', frames('walk', 8), 180, 8);
writeGif('wave.gif', frames('wave', 8), 180, 6);
