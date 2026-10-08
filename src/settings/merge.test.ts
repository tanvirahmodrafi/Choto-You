import { describe, expect, it } from 'vitest';
import { mergeSettings } from './merge';
import { DEFAULT_SETTINGS } from './types';

describe('mergeSettings', () => {
  it('returns defaults for nothing at all', () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings('not an object')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps values it recognises', () => {
    const merged = mergeSettings({ general: { soundEnabled: false } });
    expect(merged.general.soundEnabled).toBe(false);
  });

  it('fills in fields a previous version did not save', () => {
    // A database written by an older build is missing whole sections.
    const merged = mergeSettings({ general: { soundEnabled: false } });
    expect(merged.behavior).toEqual(DEFAULT_SETTINGS.behavior);
    expect(merged.advanced.maxFps).toBe(DEFAULT_SETTINGS.advanced.maxFps);
  });

  it('rejects values of the wrong type, field by field', () => {
    const merged = mergeSettings({
      general: { soundEnabled: 'yes', launchMinimized: true },
      character: { scale: 'big' },
    });
    // One bad field costs only its own default.
    expect(merged.general.soundEnabled).toBe(true);
    expect(merged.general.launchMinimized).toBe(true);
    expect(merged.character.scale).toBe(DEFAULT_SETTINGS.character.scale);
  });

  it('clamps numbers into a usable range', () => {
    // A hand-edited scale of 500 would make the companion unusable, and
    // there would be no way to fix it from a settings window it covers.
    expect(mergeSettings({ character: { scale: 500 } }).character.scale).toBe(3);
    expect(mergeSettings({ character: { scale: 0 } }).character.scale).toBe(0.5);
    expect(mergeSettings({ advanced: { maxFps: -10 } }).advanced.maxFps).toBe(15);
  });

  it('falls back to the default for NaN and Infinity rather than clamping', () => {
    // Neither is a finite number, so neither is a meaningful value to clamp:
    // Infinity would silently become "maximum size", which is not what a
    // corrupt value should mean.
    expect(mergeSettings({ character: { scale: Number.NaN } }).character.scale).toBe(1);
    expect(mergeSettings({ character: { scale: Number.POSITIVE_INFINITY } }).character.scale).toBe(1);
  });

  it('falls back on an unknown enum value', () => {
    expect(mergeSettings({ display: { mode: 'teleport' } }).display.mode).toBe('primary');
    expect(mergeSettings({ display: { mode: 'roam' } }).display.mode).toBe('roam');
  });

  it('treats an empty character id as missing', () => {
    expect(mergeSettings({ character: { characterId: '' } }).character.characterId).toBe('pip');
  });

  it('accepts a null specific display, and keeps a real one', () => {
    expect(mergeSettings({ display: { specificDisplayId: 42 } }).display.specificDisplayId).toBeNull();
    expect(
      mergeSettings({ display: { specificDisplayId: 'Monitor #1' } }).display.specificDisplayId,
    ).toBe('Monitor #1');
  });

  it('ignores a section stored as the wrong shape', () => {
    expect(mergeSettings({ behavior: 'on' }).behavior).toEqual(DEFAULT_SETTINGS.behavior);
    expect(mergeSettings({ behavior: [1, 2] }).behavior).toEqual(DEFAULT_SETTINGS.behavior);
  });
});

/**
 * `roamMode` replaced a `walkAround` boolean. Anyone who had turned wandering
 * off must stay off after an update rather than finding the avatar pacing
 * around again.
 */
describe('roam mode migration', () => {
  it('defaults to roaming when nothing is stored', () => {
    expect(mergeSettings({}).behavior.roamMode).toBe('always');
  });

  it('reads a stored roam mode', () => {
    expect(mergeSettings({ behavior: { roamMode: 'reminders-only' } }).behavior.roamMode).toBe(
      'reminders-only',
    );
  });

  it('carries the old walkAround boolean across', () => {
    expect(mergeSettings({ behavior: { walkAround: false } }).behavior.roamMode).toBe('never');
    expect(mergeSettings({ behavior: { walkAround: true } }).behavior.roamMode).toBe('always');
  });

  it('prefers the new field when a database holds both', () => {
    const settings = mergeSettings({ behavior: { walkAround: true, roamMode: 'never' } });
    expect(settings.behavior.roamMode).toBe('never');
  });

  it('falls back for an unrecognised mode rather than storing it', () => {
    expect(mergeSettings({ behavior: { roamMode: 'sideways' } }).behavior.roamMode).toBe('always');
  });

  it('ignores a non-boolean walkAround', () => {
    expect(mergeSettings({ behavior: { walkAround: 'yes' } }).behavior.roamMode).toBe('always');
  });
});

/**
 * `avatarRevision` is how the overlay learns that an avatar's *files* changed
 * when its id did not — the case of re-importing the avatar already on screen.
 */
describe('avatar revision', () => {
  it('defaults to zero', () => {
    expect(mergeSettings({}).character.avatarRevision).toBe(0);
  });

  it('reads a stored revision', () => {
    expect(mergeSettings({ character: { avatarRevision: 7 } }).character.avatarRevision).toBe(7);
  });

  it('falls back for a missing or nonsense value rather than breaking startup', () => {
    expect(mergeSettings({ character: {} }).character.avatarRevision).toBe(0);
    expect(mergeSettings({ character: { avatarRevision: 'two' } }).character.avatarRevision).toBe(0);
    expect(mergeSettings({ character: { avatarRevision: -5 } }).character.avatarRevision).toBe(0);
  });
});
