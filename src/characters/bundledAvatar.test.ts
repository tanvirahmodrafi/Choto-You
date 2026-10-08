import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AVATAR_ID } from './AvatarRegistry';
import { ANIMATION_SLOTS } from './stills';

/**
 * Checks the avatar pack that ships in the bundle.
 *
 * It is a build output — `npm run assets:character` writes it from the artwork
 * in `art/` — and everything here is something that build could get wrong
 * without anyone noticing until the companion was on screen: a row of the sheet
 * missing, a frame that was never written, a pose the runtime waits on that can
 * never end.
 */

const PACKS = join(__dirname, '..', '..', 'public', 'characters');

interface Animation {
  readonly fps: number;
  readonly loop: boolean;
  readonly frames: readonly string[];
}

function read(path: string): unknown {
  return JSON.parse(readFileSync(join(PACKS, path), 'utf8'));
}

const index = read('index.json') as readonly { id: string; name: string; thumbnail: string }[];
const manifest = read(`${DEFAULT_AVATAR_ID}/character.json`) as {
  id: string;
  schemaVersion: number;
  thumbnail: string;
  animations: Record<string, Animation>;
};

describe('the bundled avatar', () => {
  it('is the one the app falls back to, and the picker lists it', () => {
    expect(index.map((entry) => entry.id)).toContain(DEFAULT_AVATAR_ID);
    expect(manifest.id).toBe(DEFAULT_AVATAR_ID);
    expect(manifest.schemaVersion).toBe(2);

    for (const entry of index) {
      expect(existsSync(join(PACKS, entry.id, 'character.json'))).toBe(true);
      expect(existsSync(join(PACKS, entry.thumbnail))).toBe(true);
    }
  });

  it('has artwork for every slot the runtime can ask for', () => {
    // A missing slot is not a crash — the player falls back to idle — but it is
    // a blank stare at the moment the character was meant to react.
    for (const slot of ANIMATION_SLOTS) {
      expect(Object.keys(manifest.animations)).toContain(slot);
    }
  });

  it('references only frames that were actually written', () => {
    for (const [slot, animation] of Object.entries(manifest.animations)) {
      expect(animation.frames.length, slot).toBeGreaterThan(0);
      expect(animation.fps, slot).toBeGreaterThan(0);
      for (const frame of animation.frames) {
        expect(existsSync(join(PACKS, DEFAULT_AVATAR_ID, frame)), `${slot}: ${frame}`).toBe(true);
      }
    }
    expect(existsSync(join(PACKS, DEFAULT_AVATAR_ID, manifest.thumbnail))).toBe(true);
  });

  it('lets every pose the runtime waits on finish', () => {
    // These are played with an `onFinish` that hands the character back. A
    // looping clip never finishes, so it never releases the priority it was
    // played at: one click and the character would wear its delighted face for
    // the rest of the session, because walking ranks below a reaction.
    for (const slot of ['jump', 'land', 'wake', 'happy', 'surprised']) {
      expect(manifest.animations[slot]?.loop, slot).toBe(false);
    }

    // And these must not: a pose that ended would snap back to standing while
    // the character is still being carried, or still asleep.
    for (const slot of ['idle', 'walk', 'wave', 'dragged', 'fall', 'sleep']) {
      expect(manifest.animations[slot]?.loop, slot).toBe(true);
    }
  });

  it('keeps the drawn sequences animated rather than held', () => {
    // The three rows the sheet draws as animations are what stop the companion
    // being a picture slid across the desktop.
    for (const slot of ['idle', 'walk', 'wave']) {
      expect(manifest.animations[slot]?.frames.length, slot).toBeGreaterThan(1);
    }
  });
});
