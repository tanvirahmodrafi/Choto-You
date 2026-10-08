import { describe, expect, it } from 'vitest';
import {
  boundariesWithin,
  detectCellBoundaries,
  floodFillBackground,
  isMostlyTransparent,
  keyOutBackground,
  measureOpaqueBounds,
  removeTopEdgeFragments,
  unionBounds,
} from './pixels';

/** The chroma green the prompt asks for, as RGB. */
const GREEN: readonly [number, number, number] = [0x00, 0xb1, 0x40];

/** Builds an RGBA buffer filled with one colour. */
function filled(
  width: number,
  height: number,
  colour: readonly [number, number, number],
  alpha = 255,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = colour[0];
    data[index + 1] = colour[1];
    data[index + 2] = colour[2];
    data[index + 3] = alpha;
  }
  return data;
}

function setPixel(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  colour: readonly [number, number, number],
): void {
  const index = (y * width + x) * 4;
  data[index] = colour[0];
  data[index + 1] = colour[1];
  data[index + 2] = colour[2];
  data[index + 3] = 255;
}

describe('keyOutBackground', () => {
  it('removes the flat green the prompt asks for, keeping the character', () => {
    const data = filled(8, 8, GREEN);
    // A small red "character" in the middle.
    setPixel(data, 8, 4, 4, [220, 40, 40]);
    setPixel(data, 8, 4, 5, [220, 40, 40]);

    expect(keyOutBackground(data, 8, 8)).toBe(true);

    // Corner is now transparent, the character is not.
    expect(data[3]).toBe(0);
    expect(data[(4 * 8 + 4) * 4 + 3]).toBe(255);
  });

  it('tolerates the compression noise a generated image carries', () => {
    const data = filled(8, 8, GREEN);
    // Nudge every pixel slightly, as JPEG-ish artefacts would.
    for (let index = 0; index < data.length; index += 4) {
      data[index + 1] = (data[index + 1] ?? 0) + (index % 7) - 3;
    }
    setPixel(data, 8, 4, 4, [220, 40, 40]);

    expect(keyOutBackground(data, 8, 8)).toBe(true);
    expect(data[3]).toBe(0);
  });

  it('leaves an already transparent image alone', () => {
    const data = filled(8, 8, [0, 0, 0], 0);
    setPixel(data, 8, 4, 4, [220, 40, 40]);

    expect(keyOutBackground(data, 8, 8)).toBe(false);
    expect(data[(4 * 8 + 4) * 4 + 3]).toBe(255);
  });

  it('refuses when the corners disagree, as on a photo background', () => {
    const data = filled(8, 8, GREEN);
    // One corner from a different part of a photographic background.
    setPixel(data, 8, 7, 7, [30, 30, 200]);

    expect(keyOutBackground(data, 8, 8)).toBe(false);
    // Nothing touched: a gradient is not something a colour key can fix.
    expect(data[3]).toBe(255);
  });

  it('refuses rather than erasing an image that is entirely background', () => {
    const data = filled(8, 8, GREEN);

    expect(keyOutBackground(data, 8, 8)).toBe(false);
    // Every pixel must still be opaque, or the cell would come out blank.
    for (let index = 3; index < data.length; index += 4) {
      expect(data[index]).toBe(255);
    }
  });

  it('works with a white background as well as the requested green', () => {
    const data = filled(8, 8, [255, 255, 255]);
    for (let y = 2; y < 6; y++) {
      for (let x = 2; x < 6; x++) setPixel(data, 8, x, y, [20, 20, 20]);
    }

    expect(keyOutBackground(data, 8, 8)).toBe(true);
    expect(data[3]).toBe(0);
    expect(data[(3 * 8 + 3) * 4 + 3]).toBe(255);
  });

  it('ignores an image too small to have distinct corners', () => {
    expect(keyOutBackground(filled(1, 1, GREEN), 1, 1)).toBe(false);
  });
});

describe('isMostlyTransparent', () => {
  it('calls a fully transparent cell empty', () => {
    expect(isMostlyTransparent(filled(16, 16, GREEN, 0))).toBe(true);
  });

  it('does not call a drawn cell empty', () => {
    expect(isMostlyTransparent(filled(16, 16, GREEN, 255))).toBe(false);
  });

  it('ignores a few stray anti-aliased pixels', () => {
    const data = filled(32, 32, GREEN, 0);
    // Two opaque pixels out of 1024 is leftover edge noise, not artwork.
    setPixel(data, 32, 0, 0, [10, 10, 10]);
    setPixel(data, 32, 1, 0, [10, 10, 10]);

    expect(isMostlyTransparent(data)).toBe(true);
  });

  it('treats an empty buffer as empty rather than dividing by zero', () => {
    expect(isMostlyTransparent(new Uint8ClampedArray(0))).toBe(true);
  });
});

describe('measureOpaqueBounds', () => {
  /** Builds a transparent buffer with one opaque rectangle drawn in it. */
  function withRect(
    width: number,
    height: number,
    rect: { x: number; y: number; w: number; h: number },
    alpha = 255,
  ): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        data[(y * width + x) * 4 + 3] = alpha;
      }
    }
    return data;
  }

  it('finds the drawn rectangle, with an exclusive far edge', () => {
    const data = withRect(16, 16, { x: 3, y: 5, w: 4, h: 6 });
    expect(measureOpaqueBounds(data, 16, 16)).toEqual({
      left: 3,
      top: 5,
      right: 7,
      bottom: 11,
    });
  });

  it('ignores the faint halo generated art carries', () => {
    const data = withRect(16, 16, { x: 6, y: 6, w: 2, h: 2 });
    // A ring of barely-visible pixels across the whole frame, as measured on a
    // real sheet: taking any non-zero alpha would report the entire frame.
    for (let index = 3; index < data.length; index += 4) {
      if ((data[index] ?? 0) === 0) data[index] = 20;
    }

    expect(measureOpaqueBounds(data, 16, 16)).toEqual({
      left: 6,
      top: 6,
      right: 8,
      bottom: 8,
    });
  });

  it('returns null for a frame with nothing solid in it', () => {
    expect(measureOpaqueBounds(new Uint8ClampedArray(16 * 16 * 4), 16, 16)).toBeNull();
  });

  it('honours a custom threshold', () => {
    const data = withRect(16, 16, { x: 2, y: 2, w: 3, h: 3 }, 100);
    expect(measureOpaqueBounds(data, 16, 16, 128)).toBeNull();
    expect(measureOpaqueBounds(data, 16, 16, 64)).not.toBeNull();
  });
});

describe('unionBounds', () => {
  const a = { left: 2, top: 3, right: 6, bottom: 9 };
  const b = { left: 4, top: 1, right: 10, bottom: 7 };

  it('covers both rectangles', () => {
    expect(unionBounds(a, b)).toEqual({ left: 2, top: 1, right: 10, bottom: 9 });
  });

  it('passes through when one side is missing', () => {
    expect(unionBounds(null, b)).toEqual(b);
    expect(unionBounds(a, null)).toEqual(a);
    expect(unionBounds(null, null)).toBeNull();
  });
});

describe('floodFillBackground', () => {
  /**
   * Paints a two-tone checkerboard, as image models do when asked for
   * transparency. The tones are the ones measured on a real generated sheet.
   */
  function checkerboard(width: number, height: number, square = 2): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const light = (Math.floor(x / square) + Math.floor(y / square)) % 2 === 0;
        const tone = light ? 251 : 204;
        const index = (y * width + x) * 4;
        data[index] = tone;
        data[index + 1] = tone;
        data[index + 2] = tone;
        data[index + 3] = 255;
      }
    }
    return data;
  }

  function paint(
    data: Uint8ClampedArray,
    width: number,
    rect: { x: number; y: number; w: number; h: number },
    colour: readonly [number, number, number],
  ): void {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const index = (y * width + x) * 4;
        data[index] = colour[0];
        data[index + 1] = colour[1];
        data[index + 2] = colour[2];
        data[index + 3] = 255;
      }
    }
  }

  it('removes a painted-on checkerboard, which a single-colour key cannot', () => {
    const data = checkerboard(24, 24);
    paint(data, 24, { x: 8, y: 8, w: 8, h: 8 }, [30, 60, 160]);

    // The two tones differ by more than the key tolerance, so the corners
    // disagree and the single-colour key refuses outright.
    expect(keyOutBackground(checkerboardCopy(data), 24, 24)).toBe(false);

    expect(floodFillBackground(data, 24, 24)).toBe(true);
    expect(data[3]).toBe(0);
    expect(data[(12 * 24 + 12) * 4 + 3]).toBe(255);
  });

  function checkerboardCopy(data: Uint8ClampedArray): Uint8ClampedArray {
    return new Uint8ClampedArray(data);
  }

  it('does not punch holes through parts of the character that match the background', () => {
    const data = checkerboard(24, 24);
    // A dark outline enclosing a white interior — the shoes problem: white
    // shoes are the same colour as a white background, and a global colour key
    // would erase them. A flood cannot reach them.
    paint(data, 24, { x: 7, y: 7, w: 10, h: 10 }, [20, 20, 20]);
    paint(data, 24, { x: 9, y: 9, w: 6, h: 6 }, [251, 251, 251]);

    expect(floodFillBackground(data, 24, 24)).toBe(true);
    expect(data[3]).toBe(0);
    // The enclosed white survives.
    expect(data[(12 * 24 + 12) * 4 + 3]).toBe(255);
  });

  it('removes a plain flat background too', () => {
    const data = new Uint8ClampedArray(16 * 16 * 4);
    paint(data, 16, { x: 0, y: 0, w: 16, h: 16 }, [0, 0xb1, 0x40]);
    paint(data, 16, { x: 6, y: 6, w: 4, h: 4 }, [220, 40, 40]);

    expect(floodFillBackground(data, 16, 16)).toBe(true);
    expect(data[3]).toBe(0);
    expect(data[(8 * 16 + 8) * 4 + 3]).toBe(255);
  });

  it('leaves an already transparent sheet alone', () => {
    const data = new Uint8ClampedArray(16 * 16 * 4);
    paint(data, 16, { x: 6, y: 6, w: 4, h: 4 }, [220, 40, 40]);

    expect(floodFillBackground(data, 16, 16)).toBe(false);
    expect(data[(8 * 16 + 8) * 4 + 3]).toBe(255);
  });

  it('refuses a busy edge, which means a photographic background', () => {
    const data = new Uint8ClampedArray(16 * 16 * 4);
    // Every border pixel a different colour: more tones than a flat background
    // could have, so there is nothing safe to flood.
    for (let x = 0; x < 16; x++) {
      paint(data, 16, { x, y: 0, w: 1, h: 1 }, [x * 16, 255 - x * 16, (x * 7) % 256]);
      paint(data, 16, { x, y: 15, w: 1, h: 1 }, [(x * 11) % 256, x * 16, 200 - x * 12]);
    }
    for (let y = 0; y < 16; y++) {
      paint(data, 16, { x: 0, y, w: 1, h: 1 }, [y * 15, (y * 9) % 256, 255 - y * 16]);
      paint(data, 16, { x: 15, y, w: 1, h: 1 }, [(y * 13) % 256, 255 - y * 15, y * 16]);
    }

    expect(floodFillBackground(data, 16, 16)).toBe(false);
  });

  it('refuses when flooding would leave nothing behind', () => {
    const data = checkerboard(16, 16);

    expect(floodFillBackground(data, 16, 16)).toBe(false);
    // Still opaque, so the cell does not come out blank.
    expect(data[3]).toBe(255);
  });
});

describe('detectCellBoundaries', () => {
  /** Builds a sheet of `rows` bands, each with a drawn block at a given offset. */
  function sheet(
    width: number,
    height: number,
    bands: readonly { readonly top: number; readonly bottom: number }[],
  ): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4);
    for (const band of bands) {
      for (let y = band.top; y < band.bottom; y++) {
        for (let x = 2; x < width - 2; x++) data[(y * width + x) * 4 + 3] = 255;
      }
    }
    return data;
  }

  it('returns one more boundary than there are rows, spanning the image', () => {
    const data = sheet(20, 100, [{ top: 5, bottom: 20 }]);
    const edges = boundariesWithin(data, 20, 100, 4, 0, 20);

    expect(edges).toHaveLength(5);
    expect(edges[0]).toBe(0);
    expect(edges[4]).toBe(100);
  });

  it('snaps a boundary to the real gap rather than the even split', () => {
    // Two bands whose gap sits at 55, where an even split would cut at 50 —
    // straight through the first band's lower edge.
    const data = sheet(20, 100, [
      { top: 5, bottom: 54 },
      { top: 58, bottom: 95 },
    ]);
    const edges = boundariesWithin(data, 20, 100, 2, 0, 20);

    expect(edges[1]).toBeGreaterThanOrEqual(54);
    expect(edges[1]).toBeLessThanOrEqual(58);
  });

  it('stays near where the boundary was expected when rows genuinely touch', () => {
    // No gap at all: the least-damaging cut is still wanted, near the expected
    // position rather than at an arbitrary place.
    const data = sheet(20, 100, [{ top: 0, bottom: 100 }]);
    const edges = boundariesWithin(data, 20, 100, 2, 0, 20);

    expect(Math.abs((edges[1] ?? 0) - 50)).toBeLessThanOrEqual(8);
  });

  it('keeps boundaries strictly increasing', () => {
    const data = sheet(20, 100, [{ top: 0, bottom: 100 }]);
    const edges = boundariesWithin(data, 20, 100, 4, 0, 20);

    for (let index = 1; index < edges.length; index++) {
      expect(edges[index]!).toBeGreaterThan(edges[index - 1]!);
    }
  });

  it('finds a real gap that sits well outside the even split', () => {
    // The measured failure: on a sheet whose rows were drawn at 120% of their
    // cell height, the first real gap sat 15px beyond a 15% window, so the cut
    // landed inside the figure and took 29px — the white shoes — off the bottom
    // of every drawing in the row.
    const width = 20;
    const height = 100;
    const data = new Uint8ClampedArray(width * height * 4);
    const draw = (top: number, bottom: number): void => {
      for (let y = top; y < bottom; y++) {
        for (let x = 2; x < width - 2; x++) data[(y * width + x) * 4 + 3] = 255;
      }
    };

    // Two rows of 60 in a 100px sheet: the gap is at 61, where an even split
    // would cut at 50 and a 15% window would reach only 57.
    draw(1, 61);
    draw(64, 99);

    const edges = boundariesWithin(data, width, height, 2, 0, width);

    expect(edges[1]).toBeGreaterThanOrEqual(61);
    expect(edges[1]).toBeLessThanOrEqual(64);
  });

  it('prefers the gap nearest the expected boundary, not the first one found', () => {
    const width = 20;
    const height = 120;
    const data = new Uint8ClampedArray(width * height * 4);
    const draw = (top: number, bottom: number): void => {
      for (let y = top; y < bottom; y++) {
        for (let x = 2; x < width - 2; x++) data[(y * width + x) * 4 + 3] = 255;
      }
    };

    // Three bands, so the wide search around the first boundary (expected 40)
    // can see both the gap at 30 and the gap at 52. The nearer one wins.
    draw(1, 30);
    draw(34, 52);
    draw(56, 119);

    const edges = boundariesWithin(data, width, height, 3, 0, width);

    expect(edges[1]).toBeGreaterThanOrEqual(30);
    expect(edges[1]).toBeLessThanOrEqual(33);
  });

  it('lets one column cut lower than another to spare the feet', () => {
    // The measured failure: a sheet drawn larger than its cells, where one
    // column's figure overflows the boundary and the next column's does not.
    // A single cut across the sheet has to take the shoes off the overflowing
    // one; found per column, it can go below them.
    const width = 20;
    const height = 100;
    const data = new Uint8ClampedArray(width * height * 4);
    const draw = (left: number, right: number, top: number, bottom: number): void => {
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) data[(y * width + x) * 4 + 3] = 255;
      }
    };

    // Left column: ends well above the halfway line. Right column: overflows
    // past it, with its own gap a few pixels lower.
    draw(1, 9, 5, 44);
    draw(1, 9, 56, 95);
    draw(11, 19, 5, 54);
    draw(11, 19, 58, 95);

    const edges = detectCellBoundaries(data, width, height, 2, 2);

    expect(edges).toHaveLength(2);
    expect(edges[0]![1]).toBeLessThanOrEqual(56);
    // The overflowing column keeps everything down to its own gap.
    expect(edges[1]![1]).toBeGreaterThanOrEqual(54);
    expect(edges[1]![1]).toBeLessThanOrEqual(58);
  });

  it('splits the columns evenly, including a width that does not divide', () => {
    const data = sheet(21, 100, [{ top: 5, bottom: 20 }]);
    const edges = detectCellBoundaries(data, 21, 100, 2, 2);

    expect(edges).toHaveLength(2);
    for (const column of edges) {
      expect(column[0]).toBe(0);
      expect(column[column.length - 1]).toBe(100);
    }
  });
});

describe('removeTopEdgeFragments', () => {
  function blank(width: number, height: number): Uint8ClampedArray {
    return new Uint8ClampedArray(width * height * 4);
  }

  function block(
    data: Uint8ClampedArray,
    width: number,
    rect: { x: number; y: number; w: number; h: number },
  ): void {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        data[(y * width + x) * 4 + 3] = 255;
      }
    }
  }

  function opaqueCount(data: Uint8ClampedArray): number {
    let count = 0;
    for (let index = 3; index < data.length; index += 4) if ((data[index] ?? 0) > 16) count++;
    return count;
  }

  it('erases a small fragment sliced in at the top edge', () => {
    const data = blank(20, 20);
    block(data, 20, { x: 4, y: 6, w: 12, h: 14 }); // the character
    block(data, 20, { x: 6, y: 0, w: 4, h: 2 }); // shoes bled in from above

    const erased = removeTopEdgeFragments(data, 20, 20);

    expect(erased).toBe(8);
    expect(data[(0 * 20 + 7) * 4 + 3]).toBe(0);
    // The character is untouched.
    expect(data[(10 * 20 + 10) * 4 + 3]).toBe(255);
  });

  it('keeps a detached mark that does not touch the top edge', () => {
    const data = blank(20, 20);
    block(data, 20, { x: 4, y: 6, w: 12, h: 14 });
    // "Zzz" beside a sleeping character: detached, but inside the frame.
    block(data, 20, { x: 15, y: 3, w: 3, h: 2 });
    const before = opaqueCount(data);

    expect(removeTopEdgeFragments(data, 20, 20)).toBe(0);
    expect(opaqueCount(data)).toBe(before);
  });

  it('keeps a large shape at the top edge, which is the character itself', () => {
    const data = blank(20, 20);
    // A tall character drawn right up against the top of its frame.
    block(data, 20, { x: 4, y: 0, w: 12, h: 20 });
    const before = opaqueCount(data);

    expect(removeTopEdgeFragments(data, 20, 20)).toBe(0);
    expect(opaqueCount(data)).toBe(before);
  });

  it('does nothing when the frame holds a single shape', () => {
    const data = blank(20, 20);
    block(data, 20, { x: 4, y: 2, w: 10, h: 16 });

    expect(removeTopEdgeFragments(data, 20, 20)).toBe(0);
  });

  it('does nothing on an empty frame', () => {
    expect(removeTopEdgeFragments(blank(20, 20), 20, 20)).toBe(0);
  });
});
