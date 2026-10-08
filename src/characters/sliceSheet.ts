import { createLogger } from '@/utils/logger';
import {
  detectRowBoundaries,
  floodFillBackground,
  isMostlyTransparent,
  measureOpaqueBounds,
  removeTopEdgeFragments,
  unionBounds,
  type Bounds,
} from './pixels';

const log = createLogger('CHARACTER');

/**
 * Cuts a sprite sheet into its cells.
 *
 * Cells are kept at a uniform size and are never trimmed to their contents.
 * Trimming would be tempting — most cells have transparent margins — but it
 * would also destroy the alignment between frames, and a walk cycle whose
 * frames are each centred on their own bounding box jitters horribly.
 *
 * The pixel decisions live in `pixels.ts`; what is here is the canvas work.
 */

export interface SlicedCell {
  /** Index in the grid, left to right then top to bottom. */
  readonly index: number;
  /** PNG bytes, base64 encoded, ready to hand to the save command. */
  readonly data: string;
  /** Object URL for previewing. The caller revokes it. */
  readonly previewUrl: string;
  /** True when the cell is blank, i.e. the model left it empty. */
  readonly isEmpty: boolean;
}

export interface SliceResult {
  readonly cells: readonly SlicedCell[];
  readonly cellWidth: number;
  readonly cellHeight: number;
  /** True when a flat background colour was detected and keyed out. */
  readonly removedBackground: boolean;
  /**
   * Where the artwork actually sits, as fractions of the cell, measured across
   * every non-blank cell. Used to fit the pack's hitbox to the character rather
   * than to the transparent box around it.
   */
  readonly contentBounds: Bounds | null;
  /**
   * How far down the cell the character's feet are, as a fraction, taken from
   * the first drawn cell — the standing pose, which is the one that defines
   * where the ground is. Without this the character floats above or sinks into
   * the bottom of the screen by however much margin the model happened to leave.
   */
  readonly baselineY: number | null;
}

export async function sliceSheet(
  file: File,
  options: {
    readonly columns: number;
    readonly rows: number;
    /** Key out a flat background when the image has no transparency of its own. */
    readonly removeBackground: boolean;
  },
): Promise<SliceResult> {
  const { columns, rows } = options;
  if (columns < 1 || rows < 1) throw new Error('The grid must have at least one row and column.');

  const bitmap = await loadBitmap(file);
  try {
    const cellWidth = Math.floor(bitmap.width / columns);
    const cellHeight = Math.floor(bitmap.height / rows);
    if (cellWidth < 8 || cellHeight < 8) {
      throw new Error(
        `That image is only ${bitmap.width}×${bitmap.height}, which is too small to cut into ${columns}×${rows} poses.`,
      );
    }

    // Key the whole sheet once rather than cell by cell, so every cell is
    // judged against the same background colour.
    const sheet = toContext(bitmap.width, bitmap.height);
    sheet.drawImage(bitmap, 0, 0);

    // Removed across the whole sheet rather than cell by cell, so every cell is
    // judged against the same background.
    const full = sheet.getImageData(0, 0, bitmap.width, bitmap.height);
    let removedBackground = false;
    if (options.removeBackground) {
      removedBackground = floodFillBackground(full.data, full.width, full.height);
      if (removedBackground) sheet.putImageData(full, 0, 0);
    }

    // Rows are found from the artwork, not assumed. The model's grid is rarely
    // exactly even, and a boundary a few pixels out slices through the feet of
    // the row above — which then appear floating over the next row's head.
    const rowEdges = detectRowBoundaries(full.data, full.width, full.height, rows);

    // One frame size for the whole pack, taken from the tallest row. Each row's
    // band is drawn bottom-aligned into it, so the characters stand on a common
    // line and the alignment *within* a row — which is what an animation loops
    // over — is left exactly as the model drew it.
    const frameHeight = Math.max(
      ...Array.from({ length: rows }, (_, index) => (rowEdges[index + 1] ?? 0) - (rowEdges[index] ?? 0)),
    );

    const cells: SlicedCell[] = [];
    const cell = toContext(cellWidth, frameHeight);
    let contentBounds: Bounds | null = null;
    let baselineY: number | null = null;
    let fragmentsRemoved = 0;

    for (let row = 0; row < rows; row++) {
      const top = rowEdges[row] ?? row * cellHeight;
      const bandHeight = (rowEdges[row + 1] ?? top + cellHeight) - top;

      for (let column = 0; column < columns; column++) {
        cell.clearRect(0, 0, cellWidth, frameHeight);
        cell.drawImage(
          sheet.canvas,
          column * cellWidth,
          top,
          cellWidth,
          bandHeight,
          0,
          // Bottom-aligned: a shorter band is padded above, never below, so the
          // character's feet stay on the frame's floor.
          frameHeight - bandHeight,
          cellWidth,
          bandHeight,
        );

        const pixels = cell.getImageData(0, 0, cellWidth, frameHeight);

        // Where the model drew its rows touching, no boundary is clean and a
        // sliver of the row above arrives at the top of this frame. Detecting
        // the rows gets the cut to the least-damaging place; this clears what
        // is left.
        const strays = removeTopEdgeFragments(pixels.data, cellWidth, frameHeight);
        if (strays > 0) {
          cell.putImageData(pixels, 0, 0);
          fragmentsRemoved += strays;
        }

        const empty = isMostlyTransparent(pixels.data);

        if (!empty) {
          const bounds = measureOpaqueBounds(pixels.data, cellWidth, frameHeight);
          contentBounds = unionBounds(contentBounds, bounds);
          // The first drawn cell is the standing pose; its feet are the ground.
          if (baselineY === null && bounds) baselineY = bounds.bottom / frameHeight;
        }

        const blob = await toPngBlob(cell.canvas);
        cells.push({
          index: row * columns + column,
          data: await toBase64(blob),
          previewUrl: URL.createObjectURL(blob),
          isEmpty: empty,
        });
      }
    }

    log.info(`Sliced a sheet into ${cells.length} cell(s) of ${cellWidth}×${frameHeight}`, {
      removedBackground,
      fragmentsRemoved,
      rowEdges,
      evenSplitWouldHaveBeen: Array.from({ length: rows + 1 }, (_, i) => Math.round(i * (bitmap.height / rows))),
    });
    return {
      cells,
      cellWidth,
      cellHeight: frameHeight,
      removedBackground,
      contentBounds,
      baselineY,
    };
  } finally {
    bitmap.close();
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch (cause) {
    throw new Error(`That file could not be read as an image. ${describe(cause)}`);
  }
}

function toContext(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  // `willReadFrequently` because every cell is read straight back; without it
  // the canvas stays on the GPU and each read stalls the pipeline.
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This system could not provide a 2D canvas.');
  return context;
}

async function toPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The sliced pose could not be encoded as a PNG.'));
    }, 'image/png');
  });
}

/**
 * Encodes a blob as base64.
 *
 * Chunked: `String.fromCharCode` is applied with the array spread as arguments,
 * and a multi-megabyte frame would overflow the call stack in one go.
 */
export async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const CHUNK = 0x8000;
  let binary = '';
  for (let start = 0; start < bytes.length; start += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(start, start + CHUNK));
  }
  return btoa(binary);
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
