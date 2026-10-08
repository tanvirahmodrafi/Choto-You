/**
 * Prepares the 1024x1024 source icon from the artwork in `art/app-icon.png`.
 *
 * The artwork arrives as a sticker — a white-outlined cut-out on a flat black
 * field — so the work here is separating the two and handing `npx tauri icon`
 * a square, transparent PNG it can expand into the platform icon set.
 *
 * No background plate is drawn. The sticker has its own outline and already
 * reads at small sizes, and a plate would only show up as a rounded rectangle
 * behind an icon that is meant to be free-form.
 *
 * Run with: npm run assets:icon
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'art', 'app-icon.png');
const SIZE = 1024;

/**
 * How bright a pixel may be and still count as the black field.
 *
 * Generous, because the artwork is a compressed render rather than flat colour:
 * its "black" is a spread of values near zero. Far below anything in the
 * sticker, whose edge is a white outline.
 */
const BACKGROUND_LEVEL = 40;

/** Share of the square the artwork is drawn into, leaving a little air. */
const COVERAGE = 0.94;

const art = decodePng(readFileSync(SOURCE));
const background = findBackground(art);
cutOut(art, background);

const box = contentBox(art, background);
const square = squareAround(box, art);
const icon = resample(crop(art, square), square.size, square.size, SIZE, SIZE);

mkdirSync(join(ROOT, 'src-tauri', 'icons'), { recursive: true });
writeFileSync(join(ROOT, 'src-tauri', 'icons', 'source.png'), encodePng(SIZE, SIZE, icon));
console.log(`Wrote src-tauri/icons/source.png (${SIZE}x${SIZE}) from art/app-icon.png.`);
console.log('Run `npx tauri icon src-tauri/icons/source.png` to expand the icon set.');

/**
 * Finds the black field, starting from the corners and spreading.
 *
 * Flooding from the edges rather than keying the colour everywhere is what
 * protects the artwork's own black: the outlines around the hair and glasses
 * are enclosed by the sticker's white border, so the flood never reaches them.
 */
function findBackground(image) {
  const { width, height, rgba } = image;
  const background = new Uint8Array(width * height);
  const queue = [];

  const consider = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixel = y * width + x;
    if (background[pixel]) return;
    const i = pixel * 4;
    if (Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) > BACKGROUND_LEVEL) return;
    background[pixel] = 1;
    queue.push(pixel);
  };

  for (let x = 0; x < width; x++) {
    consider(x, 0);
    consider(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    consider(0, y);
    consider(width - 1, y);
  }

  for (let head = 0; head < queue.length; head++) {
    const pixel = queue[head];
    const x = pixel % width;
    const y = (pixel - x) / width;
    consider(x + 1, y);
    consider(x - 1, y);
    consider(x, y + 1);
    consider(x, y - 1);
  }

  return background;
}

/**
 * Makes the field transparent, and recovers the edge.
 *
 * Where the sticker's outline meets the field the render blended the two, so
 * those pixels are a dark version of the outline rather than the outline
 * itself. Cutting them out squarely leaves a grey rind that looks like a dirty
 * halo on a light desktop. Because the blend was against black, the picture is
 * already premultiplied there: the brightness *is* the coverage, so each edge
 * pixel's alpha is taken from it and the colour divided back out.
 */
function cutOut(image, background) {
  const { width, height, rgba } = image;
  const alpha = new Uint8Array(width * height);

  for (let pixel = 0; pixel < width * height; pixel++) {
    if (background[pixel]) continue;
    const x = pixel % width;
    const y = (pixel - x) / width;

    const touchesField =
      (x > 0 && background[pixel - 1]) ||
      (x < width - 1 && background[pixel + 1]) ||
      (y > 0 && background[pixel - width]) ||
      (y < height - 1 && background[pixel + width]);

    const i = pixel * 4;
    alpha[pixel] = touchesField
      ? Math.max(rgba[i], rgba[i + 1], rgba[i + 2])
      : 255;
  }

  for (let pixel = 0; pixel < width * height; pixel++) {
    const i = pixel * 4;
    const value = alpha[pixel];
    if (value === 0) {
      rgba.writeUInt32LE(0, i);
      continue;
    }
    if (value < 255) {
      for (let channel = 0; channel < 3; channel++) {
        rgba[i + channel] = Math.min(255, Math.round((rgba[i + channel] * 255) / value));
      }
    }
    rgba[i + 3] = value;
  }
}

/** What is left of the picture once the field is gone. */
function contentBox(image, background) {
  const { width, height } = image;
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (background[y * width + x]) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < left || bottom < top) throw new Error('The artwork is entirely background.');
  return { left, right, top, bottom };
}

/** The square to cut, centred on the artwork with a margin around it. */
function squareAround(box, image) {
  const width = box.right - box.left + 1;
  const height = box.bottom - box.top + 1;
  const size = Math.round(Math.max(width, height) / COVERAGE);
  return {
    size,
    left: Math.round(box.left + width / 2 - size / 2),
    top: Math.round(box.top + height / 2 - size / 2),
  };
}

/** Cuts a square out of the picture, transparent where it falls outside. */
function crop(image, square) {
  const out = Buffer.alloc(square.size * square.size * 4);
  for (let y = 0; y < square.size; y++) {
    const sourceY = square.top + y;
    if (sourceY < 0 || sourceY >= image.height) continue;
    for (let x = 0; x < square.size; x++) {
      const sourceX = square.left + x;
      if (sourceX < 0 || sourceX >= image.width) continue;
      const source = (sourceY * image.width + sourceX) * 4;
      image.rgba.copy(out, (y * square.size + x) * 4, source, source + 4);
    }
  }
  return out;
}

/**
 * Bilinear resample, in premultiplied alpha.
 *
 * Interpolating straight RGBA blends the colour of transparent pixels into the
 * edge, which would put back the dark rind `cutOut` just removed.
 */
function resample(rgba, width, height, targetWidth, targetHeight) {
  const premultiplied = new Float32Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const alpha = rgba[i * 4 + 3] / 255;
    premultiplied[i * 4] = rgba[i * 4] * alpha;
    premultiplied[i * 4 + 1] = rgba[i * 4 + 1] * alpha;
    premultiplied[i * 4 + 2] = rgba[i * 4 + 2] * alpha;
    premultiplied[i * 4 + 3] = rgba[i * 4 + 3];
  }

  const out = Buffer.alloc(targetWidth * targetHeight * 4);
  const ratioX = width / targetWidth;
  const ratioY = height / targetHeight;

  for (let y = 0; y < targetHeight; y++) {
    const sourceY = (y + 0.5) * ratioY - 0.5;
    const y0 = Math.max(0, Math.floor(sourceY));
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = Math.min(1, Math.max(0, sourceY - y0));

    for (let x = 0; x < targetWidth; x++) {
      const sourceX = (x + 0.5) * ratioX - 0.5;
      const x0 = Math.max(0, Math.floor(sourceX));
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = Math.min(1, Math.max(0, sourceX - x0));

      const target = (y * targetWidth + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        const topLeft = premultiplied[(y0 * width + x0) * 4 + channel];
        const topRight = premultiplied[(y0 * width + x1) * 4 + channel];
        const bottomLeft = premultiplied[(y1 * width + x0) * 4 + channel];
        const bottomRight = premultiplied[(y1 * width + x1) * 4 + channel];
        const top = topLeft + (topRight - topLeft) * fx;
        const bottom = bottomLeft + (bottomRight - bottomLeft) * fx;
        out[target + channel] = Math.round(top + (bottom - top) * fy);
      }

      const alpha = out[target + 3];
      for (let channel = 0; channel < 3; channel++) {
        out[target + channel] =
          alpha === 0 ? 0 : Math.min(255, Math.round((out[target + channel] * 255) / alpha));
      }
    }
  }
  return out;
}
