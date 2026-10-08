/**
 * Pixel operations used when slicing an imported sprite sheet.
 *
 * Separated from the canvas glue in `sliceSheet.ts` so the decisions that
 * actually matter — what counts as the background, what counts as a blank cell
 * — can be tested without a browser.
 */

/**
 * How far a pixel may differ from the detected background and still be removed.
 *
 * Generous, because image models produce flat colour with compression noise and
 * soft anti-aliased edges rather than one exact value. The chroma green the
 * prompt asks for is far from any skin tone or garment, so a wide tolerance
 * costs nothing.
 */
export const KEY_TOLERANCE = 72;

/** Below this fraction of opaque pixels, a cell is treated as blank. */
const EMPTY_ALPHA_FRACTION = 0.002;

/** Alpha above which a pixel counts as drawn rather than as a soft edge. */
const OPAQUE_ENOUGH = 16;

/**
 * Makes a flat background transparent, in place.
 *
 * The background colour is taken from the image's corners rather than assumed,
 * so this works whether the model used the green it was asked for, white, or
 * something else — as long as it is flat. If the corners disagree, or are
 * already transparent, nothing is touched: a photographic or shaded background
 * is not something a colour key can fix, and a half-removed one looks far worse
 * than one left alone.
 *
 * @returns whether a background was found and removed.
 */
export function keyOutBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  tolerance = KEY_TOLERANCE,
): boolean {
  if (width < 2 || height < 2) return false;

  const corners = [
    offset(0, 0, width),
    offset(width - 1, 0, width),
    offset(0, height - 1, width),
    offset(width - 1, height - 1, width),
  ];

  // Already transparent there: the model did what was asked.
  if (corners.every((index) => data[index + 3] === 0)) return false;

  const first = corners[0];
  if (first === undefined) return false;
  const key: readonly [number, number, number] = [
    data[first] ?? 0,
    data[first + 1] ?? 0,
    data[first + 2] ?? 0,
  ];

  // All four corners must agree, or this is not a flat background.
  for (const corner of corners) {
    if (data[corner + 3] === 0) return false;
    if (distance(data, corner, key) > tolerance) return false;
  }

  let removed = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    if (distance(data, index, key) <= tolerance) {
      data[index + 3] = 0;
      removed++;
    }
  }

  // Judged by what survived, not by how much went: a sheet with only one pose
  // drawn on it is legitimately almost all background, whereas a character the
  // same colour as the background leaves nothing behind. Only the second is a
  // reason to put the image back.
  if (removed > 0 && isMostlyTransparent(data)) {
    restoreAlpha(data);
    return false;
  }

  return removed > 0;
}

/** True when a cell holds so little artwork that the model likely left it blank. */
export function isMostlyTransparent(data: Uint8ClampedArray): boolean {
  const pixels = data.length / 4;
  if (pixels === 0) return true;

  let opaque = 0;
  for (let index = 3; index < data.length; index += 4) {
    if ((data[index] ?? 0) > OPAQUE_ENOUGH) opaque++;
  }
  return opaque < pixels * EMPTY_ALPHA_FRACTION;
}

/** Byte index of a pixel's red channel. */
function offset(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

/** Euclidean distance in RGB, which is close enough for a flat key colour. */
function distance(
  data: Uint8ClampedArray,
  index: number,
  key: readonly [number, number, number],
): number {
  const dr = (data[index] ?? 0) - key[0];
  const dg = (data[index + 1] ?? 0) - key[1];
  const db = (data[index + 2] ?? 0) - key[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Undoes a keying pass that turned out to have erased everything. */
function restoreAlpha(data: Uint8ClampedArray): void {
  for (let index = 3; index < data.length; index += 4) {
    data[index] = 255;
  }
}

/** A rectangle in pixels, as the bounds of the drawn artwork in a frame. */
export interface Bounds {
  readonly left: number;
  readonly top: number;
  /** Exclusive, as with a bounding box. */
  readonly right: number;
  readonly bottom: number;
}

/**
 * Finds the drawn artwork within a frame, ignoring transparent margins.
 *
 * Generated art carries a faint halo of near-zero alpha around the character —
 * on a measured sample, 5% of the sheet sat between alpha 1 and 32. Taking any
 * non-zero alpha as "drawn" would therefore report the whole frame as content,
 * so this counts only pixels solid enough to actually see.
 *
 * Used to place a pack's anchor on the character's real feet and to fit its
 * hitbox to the real artwork, rather than assuming either.
 */
export function measureOpaqueBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 128,
): Bounds | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) < threshold) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < 0 || bottom < 0) return null;
  return { left, top, right: right + 1, bottom: bottom + 1 };
}

/** The smallest rectangle containing both, or whichever one exists. */
export function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b;
  if (!b) return a;
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

/** Largest number of distinct tones a background may use and still be removable. */
const MAX_BACKGROUND_TONES = 4;

/** How close two border samples must be to count as the same tone. */
const PALETTE_MERGE_TOLERANCE = 40;

/**
 * Removes a background by flooding inwards from the edges.
 *
 * Preferred over keying a single colour because image models frequently paint a
 * *checkerboard* into the picture — the pattern an editor uses to depict
 * transparency — rather than producing real transparency. That background has
 * two tones, so a single-colour key refuses it, and the sheet arrives fully
 * opaque.
 *
 * Flooding also makes the operation safe in a way a global colour key is not.
 * A character's white shoes are the same colour as a white background, and a
 * global key would punch holes straight through them; a flood stops at the
 * character's outline, because the shoes are not reachable from the edge.
 *
 * @returns whether a background was found and removed.
 */
export function floodFillBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  tolerance = KEY_TOLERANCE,
): boolean {
  if (width < 2 || height < 2) return false;

  // Real transparency already present: nothing to do.
  const corners = [
    offset(0, 0, width),
    offset(width - 1, 0, width),
    offset(0, height - 1, width),
    offset(width - 1, height - 1, width),
  ];
  if (corners.every((index) => data[index + 3] === 0)) return false;

  const palette = borderPalette(data, width, height);
  // More than a handful of tones along the edge means a photographic or shaded
  // background, which no amount of keying will separate cleanly.
  if (palette.length === 0 || palette.length > MAX_BACKGROUND_TONES) return false;

  const matchesBackground = (index: number): boolean => {
    if (data[index + 3] === 0) return true;
    for (const tone of palette) {
      if (distance(data, index, tone) <= tolerance) return true;
    }
    return false;
  };

  // Iterative flood fill. A recursive one would overflow the stack on a
  // megapixel sheet, where the background is a single region of ~900k pixels.
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const push = (x: number, y: number): void => {
    const pixel = y * width + x;
    if (visited[pixel]) return;
    if (!matchesBackground(pixel * 4)) return;
    visited[pixel] = 1;
    queue[tail++] = pixel;
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }

  while (head < tail) {
    const pixel = queue[head++] ?? 0;
    const x = pixel % width;
    const y = (pixel - x) / width;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }

  if (tail === 0) return false;

  // Judge by what would survive, not by how much would go: a sheet with one
  // pose drawn on it is legitimately almost all background, whereas a character
  // the same colour as its background would be erased entirely. Only the second
  // is a reason not to proceed.
  let surviving = 0;
  for (let pixel = 0; pixel < visited.length; pixel++) {
    if (!visited[pixel] && (data[pixel * 4 + 3] ?? 0) > OPAQUE_ENOUGH) surviving++;
  }
  if (surviving < visited.length * EMPTY_ALPHA_FRACTION) return false;

  for (let pixel = 0; pixel < visited.length; pixel++) {
    if (visited[pixel]) data[pixel * 4 + 3] = 0;
  }
  return true;
}

/** The distinct tones found along the image's outer edge. */
function borderPalette(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): (readonly [number, number, number])[] {
  const palette: [number, number, number][] = [];

  const consider = (index: number): void => {
    if (data[index + 3] === 0) return;
    const colour: [number, number, number] = [
      data[index] ?? 0,
      data[index + 1] ?? 0,
      data[index + 2] ?? 0,
    ];
    for (const tone of palette) {
      const dr = tone[0] - colour[0];
      const dg = tone[1] - colour[1];
      const db = tone[2] - colour[2];
      if (Math.sqrt(dr * dr + dg * dg + db * db) <= PALETTE_MERGE_TOLERANCE) return;
    }
    if (palette.length <= MAX_BACKGROUND_TONES) palette.push(colour);
  };

  for (let x = 0; x < width; x++) {
    consider(offset(x, 0, width));
    consider(offset(x, height - 1, width));
  }
  for (let y = 0; y < height; y++) {
    consider(offset(0, y, width));
    consider(offset(width - 1, y, width));
  }
  return palette;
}

/**
 * Finds where the rows of a sprite sheet actually divide.
 *
 * An even division assumes the model placed its grid perfectly, and it does
 * not: measured on a real sheet the first boundary sat 7px below where an even
 * split put it, so the cut ran through the character's shoes and the next row
 * was rendered with a pair of shoes floating above its head.
 *
 * Each internal boundary is therefore snapped to the emptiest scanline near
 * where it was expected. Where two rows genuinely touch, that is the
 * least-damaging cut rather than a clean one, which is still better than an
 * arbitrary one.
 *
 * Columns are left alone: a character is narrow relative to its cell, so the
 * vertical gutters are wide and an even split lands safely inside them.
 *
 * @returns `rows + 1` boundaries, from 0 to `height`.
 */
export function detectRowBoundaries(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  rows: number,
  searchFraction = 0.15,
): number[] {
  const band = height / rows;
  const occupancy = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    let count = 0;
    const start = y * width * 4;
    for (let x = 0; x < width; x++) {
      if ((data[start + x * 4 + 3] ?? 0) > OPAQUE_ENOUGH) count++;
    }
    occupancy[y] = count;
  }

  const boundaries: number[] = [0];
  const window = Math.max(1, Math.floor(band * searchFraction));

  for (let index = 1; index < rows; index++) {
    const expected = Math.round(index * band);
    const low = Math.max(boundaries[index - 1]! + 1, expected - window);
    const high = Math.min(height - 1, expected + window);

    let best = expected;
    let bestOccupancy = Number.POSITIVE_INFINITY;
    for (let y = low; y <= high; y++) {
      const here = occupancy[y] ?? 0;
      // Ties go to the candidate nearest where the boundary was expected, so a
      // run of empty scanlines does not pull the cut to one end of the gap.
      if (here < bestOccupancy || (here === bestOccupancy && Math.abs(y - expected) < Math.abs(best - expected))) {
        best = y;
        bestOccupancy = here;
      }
    }
    boundaries.push(best);
  }

  boundaries.push(height);
  return boundaries;
}

/**
 * Largest a stray fragment may be, relative to the character, and still be
 * treated as something that bled in from the neighbouring row.
 */
const FRAGMENT_AREA_FRACTION = 0.25;

/**
 * Erases bits of the row above that were sliced into the top of this frame.
 *
 * Where a model draws its rows touching, no cut is clean: the boundary lands
 * inside the character above, and its feet arrive at the top of the frame below
 * — the reported symptom being a pair of shoes floating over the character's
 * head.
 *
 * Only fragments that both touch the top edge and are small beside the main
 * figure are removed. That spares things a character is legitimately drawn with
 * but not joined to, such as the "Zzz" above a sleeping pose, which sits inside
 * the frame rather than against its top edge.
 *
 * @returns the number of pixels erased.
 */
export function removeTopEdgeFragments(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  const labels = new Int32Array(width * height).fill(-1);
  const areas: number[] = [];
  const touchesTop: boolean[] = [];
  const queue = new Int32Array(width * height);

  for (let start = 0; start < labels.length; start++) {
    if (labels[start] !== -1) continue;
    if ((data[start * 4 + 3] ?? 0) <= OPAQUE_ENOUGH) continue;

    const label = areas.length;
    let head = 0;
    let tail = 0;
    labels[start] = label;
    queue[tail++] = start;
    let area = 0;
    let top = false;

    while (head < tail) {
      const pixel = queue[head++] ?? 0;
      area++;
      const x = pixel % width;
      const y = (pixel - x) / width;
      if (y === 0) top = true;

      const neighbours = [
        x > 0 ? pixel - 1 : -1,
        x < width - 1 ? pixel + 1 : -1,
        y > 0 ? pixel - width : -1,
        y < height - 1 ? pixel + width : -1,
      ];
      for (const neighbour of neighbours) {
        if (neighbour < 0) continue;
        if (labels[neighbour] !== -1) continue;
        if ((data[neighbour * 4 + 3] ?? 0) <= OPAQUE_ENOUGH) continue;
        labels[neighbour] = label;
        queue[tail++] = neighbour;
      }
    }

    areas.push(area);
    touchesTop.push(top);
  }

  if (areas.length < 2) return 0;

  const largest = Math.max(...areas);
  const doomed = new Set<number>();
  for (let label = 0; label < areas.length; label++) {
    if (!touchesTop[label]) continue;
    if ((areas[label] ?? 0) >= largest * FRAGMENT_AREA_FRACTION) continue;
    doomed.add(label);
  }
  if (doomed.size === 0) return 0;

  let erased = 0;
  for (let pixel = 0; pixel < labels.length; pixel++) {
    const label = labels[pixel];
    if (label !== undefined && label >= 0 && doomed.has(label)) {
      data[pixel * 4 + 3] = 0;
      erased++;
    }
  }
  return erased;
}
