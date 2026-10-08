import { describe, expect, it } from 'vitest';
import {
  CELL_LAYOUT,
  DRAG_SEQUENCE,
  SHEET_COLUMNS,
  SHEET_HEIGHT,
  SHEET_PLAN,
  SHEET_ROWS,
  SHEET_WIDTH,
  sheetCellPlan,
} from './avatarSheet';
import { buildAvatarPrompt } from './avatarPrompt';
import { ANIMATION_SLOTS, fillAnimationSlots } from './stills';
import type { AnimationDefinition } from '@/types/character';

/**
 * The sheet plan is a contract between the prompt, the slicer and the manifest
 * writer. If they disagree, an avatar's walk frames silently become its waving
 * frames, which no type checker would catch.
 */
describe('sheet plan', () => {
  it('describes exactly as many cells as the grid has', () => {
    expect(SHEET_COLUMNS * SHEET_ROWS).toBe(32);
    expect(sheetCellPlan()).toHaveLength(SHEET_COLUMNS * SHEET_ROWS);
  });

  it('uses square high-resolution cells', () => {
    expect(SHEET_WIDTH / SHEET_COLUMNS).toBe(512);
    expect(SHEET_HEIGHT / SHEET_ROWS).toBe(512);
  });

  it('gives every row a full row of cells', () => {
    for (const row of SHEET_PLAN) {
      expect(row.cells).toHaveLength(SHEET_COLUMNS);
    }
  });

  it('provides a standing pose, which every fallback chain ends at', () => {
    expect(sheetCellPlan().some((cell) => cell.slot === 'idle')).toBe(true);
  });

  it('animates walking with eight frames', () => {
    const walkCells = sheetCellPlan().filter((cell) => cell.slot === 'walk');
    expect(walkCells).toHaveLength(8);
  });

  it('only names slots the runtime knows about', () => {
    for (const cell of sheetCellPlan()) {
      expect(ANIMATION_SLOTS).toContain(cell.slot);
    }
  });
});

describe('buildAvatarPrompt', () => {
  it('states the grid the slicer will assume', () => {
    const prompt = buildAvatarPrompt();
    expect(prompt).toContain(`${SHEET_COLUMNS}x${SHEET_ROWS} grid`);
    expect(prompt).toContain(`${SHEET_COLUMNS * SHEET_ROWS} cells`);
    expect(prompt).toContain(`${SHEET_WIDTH}x${SHEET_HEIGHT} pixels`);
    expect(prompt).toContain('512x512 pixels each');
  });

  it('lists every cell the plan describes', () => {
    const prompt = buildAvatarPrompt();
    for (const cell of sheetCellPlan()) {
      expect(prompt).toContain(cell.description);
    }
  });

  it('includes the name and extras when given', () => {
    const prompt = buildAvatarPrompt({ name: 'Ma', extras: 'wearing a white saree' });
    expect(prompt).toContain('"Ma"');
    expect(prompt).toContain('wearing a white saree');
  });

  it('reads sensibly with nothing supplied', () => {
    const prompt = buildAvatarPrompt({ name: '  ', extras: '  ' });
    expect(prompt).toContain('the person in the attached photo');
    expect(prompt).not.toContain('ALSO:');
    expect(prompt).not.toContain('""');
  });

  it('states the size and the baseline the slicer depends on', () => {
    const prompt = buildAvatarPrompt();

    // Stated as fractions of the cell, because the canvas size the prompt asks
    // for is the one thing models reliably ignore: a rule in pixels stops
    // applying the moment the sheet comes back at another resolution.
    expect(prompt).toContain(`${CELL_LAYOUT.characterHeight * 100}% of the cell's height`);
    expect(prompt).toContain(`${CELL_LAYOUT.baseline * 100}% of the way down the cell`);
    expect(prompt).toContain(`${CELL_LAYOUT.margin * 100}% of the cell`);

    // And in pixels too, for the size actually requested.
    const cellHeight = SHEET_HEIGHT / SHEET_ROWS;
    expect(prompt).toContain(`${Math.round(cellHeight * CELL_LAYOUT.characterHeight)}px`);
    expect(prompt).toContain(`${Math.round(cellHeight * CELL_LAYOUT.baseline)}px`);
  });

  it('asks for the real person in the photo, not a generic mascot', () => {
    // Nothing in the prompt used to say that the attached image is a real
    // person whose face has to be reproduced, so sheets came back as a
    // plausible cartoon of somebody else.
    const prompt = buildAvatarPrompt();
    expect(prompt).toMatch(/REAL PERSON/);
    expect(prompt).toMatch(/shape of the face and jaw/i);
    expect(prompt).toMatch(/Simplify the STYLE, never the identity/i);
  });

  it('asks for being picked up, dropped and landing as one sequence', () => {
    const prompt = buildAvatarPrompt();
    const poses = SHEET_PLAN.find((row) => row.kind === 'poses');
    if (poses?.kind !== 'poses') throw new Error('The plan has no row of poses.');

    // The cells are named by number, derived from the plan rather than written
    // out, because the row's order is a wire format and cannot be rearranged to
    // put them next to each other.
    const numbers = DRAG_SEQUENCE.map(
      (slot) => poses.cells.findIndex((cell) => cell.slot === slot) + 1,
    );
    expect(numbers.every((number) => number > 0)).toBe(true);
    expect(prompt).toContain(`cells ${numbers[0]}, ${numbers[1]} and ${numbers[2]} are three moments of ONE event`);
    expect(prompt).toMatch(/picks the character up by hand, lets go of it, and it lands/);
  });

  it('keeps the remaining poses in one register rather than five styles', () => {
    expect(buildAvatarPrompt()).toMatch(/one family rather than five unrelated drawings/);
  });

  it('warns that a character drawn too large loses its feet', () => {
    // The failure the numbers exist to prevent: sheets came back with figures
    // taller than their cells, so the cut went through the shoes.
    const prompt = buildAvatarPrompt();
    expect(prompt).toContain('feet');
    expect(prompt).toMatch(/never more than 80%/i);
  });
});

describe('fillAnimationSlots for a sheet pack', () => {
  const sequence = (name: string, frames: number): AnimationDefinition => ({
    format: 'png-sequence',
    fps: 8,
    loop: true,
    frames: Array.from({ length: frames }, (_, i) => `${name}-${i}.png`),
  });

  it('keeps multi-frame sequences intact', () => {
    const animations = fillAnimationSlots({
      idle: sequence('idle', 8),
      walk: sequence('walk', 8),
      wave: sequence('wave', 8),
    });

    expect(animations?.['walk']?.frames).toHaveLength(8);
    expect(animations?.['walk']?.loop).toBe(true);
    expect(animations?.['walk']?.fps).toBe(8);
  });

  it('fills unsupplied slots from the chains', () => {
    const animations = fillAnimationSlots({ idle: sequence('idle', 4) });
    expect(Object.keys(animations ?? {}).sort()).toEqual([...ANIMATION_SLOTS].sort());
  });

  it('makes a borrowed sequence finish when it lands in a one-shot slot', () => {
    const animations = fillAnimationSlots({ idle: sequence('idle', 4) });

    // land borrows idle, which loops. Copied as-is it would never fire
    // onFinish, and the character would be stuck in the landing pose.
    expect(animations?.['land']?.loop).toBe(false);
    expect(animations?.['land']?.frames).toHaveLength(4);
    // A real sequence keeps its own timing rather than being stretched.
    expect(animations?.['land']?.fps).toBe(8);
  });

  it('holds a borrowed single frame for a fixed moment instead', () => {
    const animations = fillAnimationSlots({
      idle: { format: 'png-sequence', fps: 1, loop: true, frames: ['idle.png'] },
    });

    expect(animations?.['land']?.loop).toBe(false);
    expect(animations?.['land']?.fps).toBeGreaterThan(1);
  });

  it('refuses a set with no standing pose', () => {
    expect(fillAnimationSlots({ walk: sequence('walk', 4) })).toBeNull();
  });

  it('ignores a slot whose frames came out empty', () => {
    const animations = fillAnimationSlots({
      idle: sequence('idle', 4),
      walk: { format: 'png-sequence', fps: 8, loop: true, frames: [] },
    });

    // walk had nothing usable, so it should have fallen back to idle.
    expect(animations?.['walk']?.frames).toEqual(animations?.['idle']?.frames);
  });
});
