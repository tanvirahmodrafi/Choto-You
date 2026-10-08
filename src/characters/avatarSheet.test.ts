import { describe, expect, it } from 'vitest';
import {
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
    expect(prompt).toContain('the person in the photo');
    expect(prompt).not.toContain('ALSO:');
    expect(prompt).not.toContain('""');
  });

  it('demands a constant baseline, which the pack anchor depends on', () => {
    expect(buildAvatarPrompt()).toContain('SAME horizontal baseline');
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
