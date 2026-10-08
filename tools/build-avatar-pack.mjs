/**
 * Builds the bundled avatar pack from the sprite sheet in `art/`.
 *
 * The sheet is one image of 8x4 drawings in the layout `SHEET_PLAN`
 * (`src/characters/avatarSheet.ts`) asks an image model for: three animated
 * rows — standing, running, peek-and-wave — then eight single poses. That file
 * is the contract; the row order here follows it and must keep following it.
 *
 * Everything else here is about turning drawings that were composed cell by
 * cell into frames that can be *animated*. A sprite whose size or position
 * wanders between cells makes the character swell and slide on screen, which
 * reads as a bug rather than as a character. So each drawing is found by its
 * own artwork rather than by an assumed grid, scaled by the width of its head —
 * the one measurement a pose cannot change — and placed on a shared baseline
 * and centre line.
 *
 * Run with: npm run assets:character
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHEET = join(ROOT, 'art', 'avatar-sheet.png');
const OUT = join(ROOT, 'public', 'characters');

const PACK_ID = 'rafi';
/**
 * The name shown in the picker and in a reminder's avatar menu.
 *
 * "Choto You" is the app; the character is Choto Rafi. The directory stays a
 * short slug, because it is also the id stored in settings.
 */
const PACK_NAME = 'Choto Rafi';

/** Cells across and down the sheet. */
const COLUMNS = 8;
const ROWS = 4;

/** The finished frame, in pixels. Square, so a flipped frame needs no offset. */
const FRAME = 256;
/** How tall the standing character is drawn inside it. */
const STANDING_HEIGHT = 232;
/** Pixels of floor left below the feet, so the character is not flush. */
const FLOOR_MARGIN = 6;

/** Alpha at or below this is invisible, and must not stretch a sprite's box. */
const ALPHA_FLOOR = 32;

/**
 * The animated rows, in sheet order, with the timing `SHEET_PLAN` authors.
 *
 * These are the three that make an avatar feel alive: a still picture slid
 * across the screen does not.
 */
const SEQUENCES = [
  { slot: 'idle', row: 1, fps: 6 },
  { slot: 'walk', row: 2, fps: 8 },
  { slot: 'wave', row: 3, fps: 6 },
];

/** Row 4, left to right. The order is `SHEET_PLAN`'s and cannot be rearranged. */
const POSES = ['jump', 'fall', 'land', 'happy', 'surprised', 'drink', 'dragged', 'sleep'];

/**
 * Slots with no drawing of their own, pointed at one that fits.
 *
 * They reference the same frame file rather than copying it: the loader caches
 * by URL, so a shared pose costs nothing twice. The runtime asks for all twelve
 * slots, so the pack is completed here rather than leaving the player to fall
 * back to standing at the moment the character wakes up.
 */
const DERIVED = [{ slot: 'wake', from: 'sleep' }];

/**
 * Slots the runtime drives with an `onFinish` callback, or expects to end.
 *
 * Getting this wrong is not cosmetic. A looping single-frame clip never
 * completes, so it never releases the priority it was played at: one click and
 * the character would wear its delighted face for the rest of the session,
 * because ordinary walking ranks below a reaction and could no longer be shown.
 */
const ONE_SHOT_SLOTS = ['happy', 'surprised', 'drink', 'jump', 'land', 'wake'];

/**
 * How long a one-shot pose is held before it reports completion, in seconds.
 *
 * A single drawing has no sequence to time it, so its one frame *is* its
 * duration: long enough to register, short enough not to feel stuck.
 */
const HOLD_SECONDS = 0.5;

// --- read the sheet -------------------------------------------------------

const sheet = decodePng(readFileSync(SHEET));

// Columns first: the gutters between drawings are wide and clean, so the strips
// can be found outright. The row boundaries are then searched for *inside each
// strip*, because whether a figure overflows its cell is a property of that one
// drawing rather than of the whole row.
const strips = findColumns(sheet);
if (strips.length !== COLUMNS) {
  throw new Error(`Found ${strips.length} columns of drawings in the sheet, expected ${COLUMNS}.`);
}

/** Every drawing, by `row,column`, cleaned and measured. */
const sprites = new Map();
/** Drawings that did not fit their cell, reported once the pack is written. */
const warnings = [];

for (const [index, strip] of strips.entries()) {
  const column = index + 1;
  const { cuts, lost } = rowCuts(sheet, strip);

  for (let row = 1; row <= ROWS; row++) {
    const sprite = measure(
      extract(sheet, { left: strip.left, right: strip.right, top: cuts[row - 1], bottom: cuts[row] }),
    );
    sprites.set(`${row},${column}`, sprite);

    // Pixels the cut went through are gone for good — almost always the soles
    // of the shoes. Worth saying out loud, because the fix is a smaller
    // character in the next sheet, not anything this tool can do.
    if (lost[row] > 0) {
      const where = row === ROWS ? 'the bottom edge of the sheet' : 'the cut below it';
      warnings.push(`row ${row}, column ${column}: ${lost[row]}px of the drawing fall past ${where}`);
    }
  }
}

// One scale per row, from the median width of the heads in it. A pose changes a
// drawing's height — leaning into a run, crouching on landing — so scaling each
// drawing to a uniform height would make the character grow and shrink as it
// moved. Head width survives every pose in the sheet.
const headWidths = new Map();
for (let row = 1; row <= ROWS; row++) {
  const widths = [];
  for (let column = 1; column <= COLUMNS; column++) {
    widths.push(sprites.get(`${row},${column}`).headWidth);
  }
  headWidths.set(row, median(widths));
}

// The standing row sets the character's size; every other row is scaled to
// match its head.
const standing = sprites.get('1,1');
const baseScale = STANDING_HEIGHT / standing.height;
const targetHead = headWidths.get(1) * baseScale;
const rowScale = new Map();
for (let row = 1; row <= ROWS; row++) {
  rowScale.set(row, targetHead / headWidths.get(row));
}

/** The y, in the finished frame, that the character's feet stand on. */
const BASELINE = FRAME - FLOOR_MARGIN;

// --- write the pack -------------------------------------------------------

rmSync(join(OUT, PACK_ID), { recursive: true, force: true });

const animations = {};
let frameCount = 0;

for (const sequence of SEQUENCES) {
  const cells = [];
  for (let column = 1; column <= COLUMNS; column++) {
    cells.push(sprites.get(`${sequence.row},${column}`));
  }

  const scale = rowScale.get(sequence.row);
  const frames = [];
  for (const [index, placement] of place(cells, scale, sequence.slot).entries()) {
    const name = `${sequence.slot}/${String(index + 1).padStart(3, '0')}.png`;
    writeFrame(name, compose(placement));
    frames.push(name);
    frameCount += 1;
  }
  animations[sequence.slot] = definition(frames, sequence.slot, sequence.fps);
}

for (const [index, slot] of POSES.entries()) {
  const sprite = sprites.get(`4,${index + 1}`);
  const name = `${slot}/001.png`;
  writeFrame(name, compose({ sprite, scale: rowScale.get(4), bottom: BASELINE }));
  frameCount += 1;
  animations[slot] = definition([name], slot);
}

for (const derived of DERIVED) {
  const source = animations[derived.from];
  if (!source) throw new Error(`"${derived.slot}" wants "${derived.from}", which was not built.`);
  animations[derived.slot] = definition(source.frames, derived.slot);
}

// The thumbnail is the standing pose, scaled down for the avatar picker.
const idleFrame = compose({ sprite: standing, scale: baseScale, bottom: BASELINE });
writeFrame('thumbnail.png', resample(idleFrame, FRAME, FRAME, 128, 128), 128);

const box = contentBox(idleFrame);
const manifest = {
  schemaVersion: 2,
  id: PACK_ID,
  name: PACK_NAME,
  version: '1.0.0',
  author: 'Original artwork, bundled with the application',
  license: 'Original artwork, bundled with the application',
  thumbnail: 'thumbnail.png',
  frameSize: { width: FRAME, height: FRAME },
  // Frames are drawn larger than the character appears, so a 2x display shows
  // them at their own resolution rather than upscaled.
  defaultScale: 0.5,
  facing: 'right',
  anchor: { x: 0.5, y: round(BASELINE / FRAME) },
  hitbox: {
    x: round(box.left / FRAME),
    y: round(box.top / FRAME),
    width: round((box.right - box.left) / FRAME),
    height: round((box.bottom - box.top) / FRAME),
  },
  movement: { walkSpeed: 70, runSpeed: 150 },
  animations,
};

write('character.json', `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  join(OUT, 'index.json'),
  `${JSON.stringify([{ id: PACK_ID, name: PACK_NAME, thumbnail: `${PACK_ID}/thumbnail.png` }], null, 2)}\n`,
);

console.log(`Built "${PACK_NAME}" from the sheet: ${frameCount} frames of ${FRAME}x${FRAME}.`);
console.log(`Slots: ${Object.keys(animations).sort().join(', ')}`);

if (warnings.length > 0) {
  console.warn(`\n${warnings.length} drawing(s) did not fit their cell:`);
  for (const warning of warnings) console.warn(`  - ${warning}`);
  console.warn(
    '\nThe sheet was drawn too large. The prompt asks for a character 75% of ' +
      'the cell height standing on a baseline 88% of the way down; a figure ' +
      'taller than that overflows into the row below, and the cut has to go ' +
      'through one of them. Nothing here can put back pixels never drawn.',
  );
}

// --- finding the drawings -------------------------------------------------

/**
 * The vertical strips the drawings sit in.
 *
 * Found from the artwork: a character is narrow relative to its cell, so the
 * gutters between columns are wide and unambiguous even where the model's grid
 * is not evenly spaced. A mark drawn beside a character — a question mark, a
 * "Zzz" — is its own narrow run with a gap either side, so a run much narrower
 * than the rest is merged into the drawing it belongs with rather than counted
 * as another column.
 */
function findColumns(image) {
  const occupied = new Array(image.width).fill(false);
  for (let x = 0; x < image.width; x++) {
    for (let y = 0; y < image.height; y++) {
      if (image.rgba[(y * image.width + x) * 4 + 3] > ALPHA_FLOOR) {
        occupied[x] = true;
        break;
      }
    }
  }

  const found = runs(occupied, 8);
  const typical = median(found.map(([left, right]) => right - left));

  const merged = [];
  for (const [index, run] of found.entries()) {
    const previous = merged[merged.length - 1];
    if (previous && run[1] - run[0] < typical * 0.4) {
      // Whichever drawing it sits closer to is the one it belongs with.
      const next = found[index + 1];
      if (run[0] - previous[1] <= (next ? next[0] - run[1] : Infinity)) {
        previous[1] = run[1];
        continue;
      }
    }
    merged.push([...run]);
  }

  return merged.map(([left, right]) => ({ left, right }));
}

/**
 * Where this column's rows divide.
 *
 * The same search the in-app importer runs (`boundariesWithin` in
 * `src/characters/pixels.ts`) — kept in step with it deliberately, so the
 * bundled avatar is cut the way an imported one is.
 *
 * An empty scanline is looked for first, and far from the even split if need
 * be: a sheet drawn larger than its cells pushes every gap downwards, and on
 * one measured sheet the first real gap sat beyond a 15% window, so the cut
 * fell inside the figure and took the whole of the white shoes off all eight
 * drawings in that row. An empty scanline cannot be inside a figure, so looking
 * further for one is safe. Only when the drawings genuinely touch does this
 * fall back to the least-damaging cut near where it was expected.
 *
 * Searching one column at a time is what saves the rest. On the sheet this
 * pack is built from, four of the eight columns have a clean gap at the third
 * boundary and four do not: a single cut across the whole sheet takes the soles
 * off every drawing in the row, while seven of the eight keep them when each
 * column chooses its own cut.
 */
function rowCuts(image, strip) {
  const occupancy = new Int32Array(image.height);
  for (let y = 0; y < image.height; y++) {
    let count = 0;
    for (let x = strip.left; x < strip.right; x++) {
      if (image.rgba[(y * image.width + x) * 4 + 3] > ALPHA_FLOOR) count += 1;
    }
    occupancy[y] = count;
  }

  const band = image.height / ROWS;
  const nearWindow = Math.max(1, Math.floor(band * 0.15));
  const wideWindow = Math.max(1, Math.floor(band * 0.45));
  const cuts = [0];
  // How much artwork each cut runs through. Zero is a clean gap; anything else
  // is a drawing too tall for its cell, losing that many pixels of itself.
  const lost = [0];

  for (let index = 1; index < ROWS; index++) {
    const expected = Math.round(index * band);
    const floor = cuts[index - 1] + 1;

    // An empty scanline, nearest to where the boundary was expected.
    let found = null;
    for (let distance = 0; distance <= wideWindow && found === null; distance++) {
      const candidates = distance === 0 ? [expected] : [expected - distance, expected + distance];
      for (const candidate of candidates) {
        if (candidate < floor || candidate > image.height - 1) continue;
        if (occupancy[candidate] === 0) {
          found = candidate;
          break;
        }
      }
    }

    if (found !== null) {
      cuts.push(found);
      lost.push(0);
      continue;
    }

    const low = Math.max(floor, expected - nearWindow);
    const high = Math.min(image.height - 1, expected + nearWindow);
    let best = expected;
    let bestOccupancy = Infinity;
    for (let y = low; y <= high; y++) {
      const nearer = Math.abs(y - expected) < Math.abs(best - expected);
      if (occupancy[y] < bestOccupancy || (occupancy[y] === bestOccupancy && nearer)) {
        best = y;
        bestOccupancy = occupancy[y];
      }
    }
    cuts.push(best);
    lost.push(bestOccupancy);
  }

  cuts.push(image.height);
  // The sheet's own last scanline: a drawing reaching it was cropped by the
  // edge of the image before this tool ever saw it.
  lost.push(occupancy[image.height - 1] ?? 0);
  return { cuts, lost };
}

/** Runs of true at least `minimum` long. */
function runs(flags, minimum) {
  const out = [];
  let start = null;
  for (const [index, flag] of flags.entries()) {
    if (flag && start === null) start = index;
    if (!flag && start !== null) {
      if (index - start >= minimum) out.push([start, index]);
      start = null;
    }
  }
  if (start !== null && flags.length - start >= minimum) out.push([start, flags.length]);
  return out;
}

/**
 * Lifts one drawing out of the sheet, and clears what bled in from above.
 *
 * Where the model drew two rows touching, no cut is clean: the boundary lands
 * inside the character above and its feet arrive at the top of this box — the
 * reported symptom being a pair of shoes floating over the character's head.
 * Only fragments that both touch the top edge and are small beside the main
 * figure are removed, which spares anything the character is legitimately drawn
 * with but not joined to.
 */
function extract(image, box) {
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const start = (box.top + y) * image.width + box.left;
    image.rgba.copy(rgba, y * width * 4, start * 4, (start + width) * 4);
  }

  const labels = new Int32Array(width * height).fill(-1);
  const areas = [];
  const touchesTop = [];
  const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  for (let seed = 0; seed < width * height; seed++) {
    if (labels[seed] !== -1 || rgba[seed * 4 + 3] <= ALPHA_FLOOR) continue;
    const label = areas.length;
    areas.push(0);
    touchesTop.push(false);

    // Breadth-first rather than recursive: a component here is tens of
    // thousands of pixels, which would overflow the stack.
    const queue = [seed];
    labels[seed] = label;
    for (let head = 0; head < queue.length; head++) {
      const pixel = queue[head];
      const x = pixel % width;
      const y = (pixel - x) / width;
      areas[label] += 1;
      if (y === 0) touchesTop[label] = true;

      for (const [dx, dy] of neighbours) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbour = ny * width + nx;
        if (labels[neighbour] !== -1 || rgba[neighbour * 4 + 3] <= ALPHA_FLOOR) continue;
        labels[neighbour] = label;
        queue.push(neighbour);
      }
    }
  }

  const largest = Math.max(0, ...areas);
  let cleared = 0;
  for (let pixel = 0; pixel < width * height; pixel++) {
    const label = labels[pixel];
    if (label < 0) continue;
    if (!touchesTop[label] || areas[label] >= largest * 0.25) continue;
    rgba.writeUInt32LE(0, pixel * 4);
    cleared += 1;
  }

  return { rgba, width, height, cleared };
}

/**
 * Measures one drawing: its own bounds, and where its head is.
 *
 * The head is taken from the top of the drawing, where a chibi character is
 * nothing but head. Its centre is a median rather than an average, so a raised
 * arm in the same band cannot drag the character off the centre line.
 */
function measure(sprite) {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;

  for (let y = 0; y < sprite.height; y++) {
    for (let x = 0; x < sprite.width; x++) {
      if (sprite.rgba[(y * sprite.width + x) * 4 + 3] <= ALPHA_FLOOR) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  const drawnHeight = bottom - top + 1;
  const headBottom = top + Math.max(1, Math.round(drawnHeight * 0.25));
  let headWidth = 0;
  const headX = [];

  for (let y = top; y < headBottom; y++) {
    let first = -1;
    let last = -1;
    for (let x = left; x <= right; x++) {
      if (sprite.rgba[(y * sprite.width + x) * 4 + 3] <= ALPHA_FLOOR) continue;
      if (first < 0) first = x;
      last = x;
      headX.push(x);
    }
    if (first >= 0) headWidth = Math.max(headWidth, last - first + 1);
  }

  return {
    rgba: sprite.rgba,
    // The box the drawing was lifted out of, which `crop` indexes into.
    boxWidth: sprite.width,
    left,
    right,
    top,
    bottom,
    width: right - left + 1,
    height: drawnHeight,
    headWidth,
    headCentre: median(headX),
  };
}

// --- placing --------------------------------------------------------------

/**
 * Decides where every frame of a sequence sits.
 *
 * A run cycle is registered by the head, not by the feet: both feet leave the
 * ground in the airborne frames, so putting each frame's lowest pixel on the
 * floor would push the character *down* exactly where it should be rising, and
 * the legs would scissor on the spot instead of carrying it. The row is shifted
 * as one so its deepest footfall lands on the floor.
 *
 * Every other row is registered by the feet. That is also a drift correction:
 * the standing and waving rows were drawn with their feet planted, so any
 * variation between those frames is the model failing to hold the pose still
 * rather than the character moving.
 */
function place(cells, scale, slot) {
  if (slot !== 'walk') {
    return cells.map((sprite) => ({ sprite, scale, bottom: BASELINE }));
  }

  const drops = cells.map((sprite) => sprite.height * scale);
  const deepest = Math.max(...drops);
  return cells.map((sprite, index) => ({
    sprite,
    scale,
    bottom: BASELINE - (deepest - drops[index]),
  }));
}

/** Draws one sprite into a frame, on the centre line with its feet at `bottom`. */
function compose({ sprite, scale, bottom }) {
  const width = Math.round(sprite.width * scale);
  const height = Math.round(sprite.height * scale);
  const scaled = resample(crop(sprite), sprite.width, sprite.height, width, height);

  const frame = Buffer.alloc(FRAME * FRAME * 4);
  const offsetX = Math.round(FRAME / 2 - (sprite.headCentre - sprite.left) * scale);
  const offsetY = Math.round(bottom - height);

  for (let y = 0; y < height; y++) {
    const targetY = y + offsetY;
    if (targetY < 0 || targetY >= FRAME) continue;
    for (let x = 0; x < width; x++) {
      const targetX = x + offsetX;
      if (targetX < 0 || targetX >= FRAME) continue;
      const source = (y * width + x) * 4;
      scaled.copy(frame, (targetY * FRAME + targetX) * 4, source, source + 4);
    }
  }
  return frame;
}

/** The drawing's own rectangle, lifted out of its box. */
function crop(sprite) {
  const out = Buffer.alloc(sprite.width * sprite.height * 4);
  for (let y = 0; y < sprite.height; y++) {
    const start = (sprite.top + y) * sprite.boxWidth + sprite.left;
    sprite.rgba.copy(out, y * sprite.width * 4, start * 4, (start + sprite.width) * 4);
  }
  return out;
}

/**
 * Bilinear resample, in premultiplied alpha.
 *
 * Interpolating straight RGBA blends the colour of transparent pixels into the
 * edge, and transparent pixels in this artwork are black: without the
 * premultiply every sprite would come out with a dark halo around it.
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
    // Sampled from the centre of the target pixel, not its corner, or the
    // image drifts half a pixel up and left as it is scaled.
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

      // Back to straight alpha, which is what a PNG stores.
      const alpha = out[target + 3];
      for (let channel = 0; channel < 3; channel++) {
        out[target + channel] =
          alpha === 0 ? 0 : Math.min(255, Math.round((out[target + channel] * 255) / alpha));
      }
    }
  }
  return out;
}

/** One slot's clip. */
function definition(frames, slot, fps) {
  const oneShot = ONE_SHOT_SLOTS.includes(slot);
  return {
    format: 'png-sequence',
    // A single drawing has no sequence to time, so a looping one holds its pose
    // and a one-shot one is held for a moment and then reports completion.
    fps: fps ?? (oneShot ? 1 / HOLD_SECONDS : 1),
    loop: !oneShot,
    frames,
  };
}

/** The artwork's bounds inside a finished frame, padded into a hitbox. */
function contentBox(frame) {
  let left = FRAME;
  let right = 0;
  let top = FRAME;
  let bottom = 0;
  for (let y = 0; y < FRAME; y++) {
    for (let x = 0; x < FRAME; x++) {
      if (frame[(y * FRAME + x) * 4 + 3] <= ALPHA_FLOOR) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  // Padded outwards: a box fitted exactly to the pixels makes a character with
  // thin limbs frustrating to grab.
  const pad = FRAME * 0.02;
  return {
    left: Math.max(0, left - pad),
    right: Math.min(FRAME, right + pad),
    top: Math.max(0, top - pad),
    bottom: Math.min(FRAME, bottom + pad),
  };
}

// --- plumbing -------------------------------------------------------------

/** Writes a square RGBA buffer into the pack as a PNG. */
function writeFrame(relativePath, rgba, size = FRAME) {
  write(relativePath, encodePng(size, size, rgba));
}

function write(relativePath, bytes) {
  const destination = join(OUT, PACK_ID, relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
