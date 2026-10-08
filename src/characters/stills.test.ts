import { describe, expect, it } from 'vitest';
import { ANIMATION_SLOTS, expandStills, isAnimationSlot } from './stills';

describe('expandStills', () => {
  it('fills every slot from a single idle image', () => {
    const animations = expandStills({ idle: 'idle.png' });

    expect(animations).not.toBeNull();
    // The whole point: one drawing is a usable avatar.
    expect(Object.keys(animations ?? {}).sort()).toEqual([...ANIMATION_SLOTS].sort());
    for (const slot of ANIMATION_SLOTS) {
      expect(animations?.[slot]?.frames).toEqual(['idle.png']);
    }
  });

  it('refuses a pack with no idle image, however many others it has', () => {
    expect(expandStills({ happy: 'happy.png', sleep: 'sleep.png' })).toBeNull();
  });

  it('prefers a nearer fallback over idle', () => {
    const animations = expandStills({ idle: 'idle.png', happy: 'happy.png' });

    // wave -> happy -> idle, so the happy drawing should win.
    expect(animations?.['wave']?.frames).toEqual(['happy.png']);
    expect(animations?.['surprised']?.frames).toEqual(['happy.png']);
    // walk has no happy step in its chain.
    expect(animations?.['walk']?.frames).toEqual(['idle.png']);
  });

  it('uses a slot’s own image when it has one', () => {
    const animations = expandStills({
      idle: 'idle.png',
      walk: 'walk.png',
      sleep: 'sleep.png',
    });

    expect(animations?.['walk']?.frames).toEqual(['walk.png']);
    expect(animations?.['sleep']?.frames).toEqual(['sleep.png']);
    // wake falls back through sleep before reaching idle.
    expect(animations?.['wake']?.frames).toEqual(['sleep.png']);
  });

  it('makes the callback-driven slots finish and the rest hold', () => {
    const animations = expandStills({ idle: 'idle.png' });

    // The runtime hands the character back via onFinish on these three; a clip
    // that looped forever would strand it in the pose.
    for (const slot of ['jump', 'land', 'wake'] as const) {
      expect(animations?.[slot]?.loop, slot).toBe(false);
      expect(animations?.[slot]?.fps).toBeGreaterThan(1);
    }

    // These stay up for as long as something is being said.
    for (const slot of ['idle', 'walk', 'wave', 'happy', 'sleep'] as const) {
      expect(animations?.[slot]?.loop, slot).toBe(true);
    }
  });

  it('ignores slot names it does not know', () => {
    const animations = expandStills({ idle: 'idle.png', dancing: 'dance.png' });

    expect(animations).not.toBeNull();
    expect(animations?.['dancing']).toBeUndefined();
  });

  it('ignores empty paths rather than treating them as images', () => {
    const animations = expandStills({ idle: 'idle.png', happy: '' });

    // happy had no real image, so it should fall back to idle.
    expect(animations?.['happy']?.frames).toEqual(['idle.png']);
  });

  it('declares every slot a one-frame sequence', () => {
    const animations = expandStills({ idle: 'idle.png' });

    for (const slot of ANIMATION_SLOTS) {
      expect(animations?.[slot]?.format).toBe('png-sequence');
      expect(animations?.[slot]?.frames).toHaveLength(1);
    }
  });
});

describe('isAnimationSlot', () => {
  it('accepts known slots and rejects anything else', () => {
    expect(isAnimationSlot('idle')).toBe(true);
    expect(isAnimationSlot('drink')).toBe(true);
    expect(isAnimationSlot('dancing')).toBe(false);
    expect(isAnimationSlot('')).toBe(false);
  });
});
