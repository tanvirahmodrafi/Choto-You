import { describe, expect, it } from 'vitest';
import { CharacterLoadError, loadCharacter, type AvatarRef } from './CharacterLoader';

/**
 * A pack directory is an ordinary folder in the app data directory, so a
 * manifest is untrusted input even though the app's own importers only ever
 * write sane ones. These cover the fields that end up as window geometry or as
 * a URL, where a bad value costs the user access to their own companion rather
 * than just a wrong-looking one.
 */

const MINIMAL = {
  schemaVersion: 2,
  id: 'probe',
  name: 'Probe',
  version: '1.0.0',
  frameSize: { width: 96, height: 96 },
  movement: { walkSpeed: 55, runSpeed: 120 },
  animations: { idle: { format: 'png-sequence', frames: ['idle.png'], fps: 8 } },
};

/** A user pack, which arrives with its manifest already read off disk. */
function pack(overrides: Record<string, unknown>): AvatarRef {
  return {
    id: 'user:probe',
    origin: 'user',
    resolve: (path) => `/packs/probe/${path}`,
    manifestText: JSON.stringify({ ...MINIMAL, ...overrides }),
    manifestId: 'probe',
  };
}

describe('loadCharacter frame size', () => {
  it('refuses a frame with no area, which would draw an unclickable window', async () => {
    await expect(loadCharacter(pack({ frameSize: { width: 0, height: 96 } }))).rejects.toThrow(
      CharacterLoadError,
    );
    await expect(loadCharacter(pack({ frameSize: { width: 96, height: -10 } }))).rejects.toThrow(
      /greater than zero/,
    );
  });

  it('caps an enormous frame rather than covering the screen with it', async () => {
    const { manifest } = await loadCharacter(pack({ frameSize: { width: 99999, height: 99999 } }));

    expect(manifest.frameSize.width).toBe(4096);
    expect(manifest.frameSize.height).toBe(4096);
  });

  it('keeps the sizes real packs use untouched', async () => {
    const { manifest } = await loadCharacter(pack({ frameSize: { width: 221, height: 262 } }));

    expect(manifest.frameSize).toEqual({ width: 221, height: 262 });
  });
});

describe('loadCharacter scale and speed', () => {
  it('clamps a scale that would make the companion impossible to find', async () => {
    expect((await loadCharacter(pack({ defaultScale: 5000 }))).manifest.defaultScale).toBe(4);
    expect((await loadCharacter(pack({ defaultScale: 0.0001 }))).manifest.defaultScale).toBe(0.05);
  });

  it('treats a scale of zero as absent, since it would draw nothing at all', async () => {
    expect((await loadCharacter(pack({ defaultScale: 0 }))).manifest.defaultScale).toBe(1);
    expect((await loadCharacter(pack({ defaultScale: -2 }))).manifest.defaultScale).toBe(1);
  });

  it('keeps the scales the sheet importer produces', async () => {
    expect((await loadCharacter(pack({ defaultScale: 0.458 }))).manifest.defaultScale).toBe(0.458);
  });

  it('replaces a walk speed that would never arrive', async () => {
    const { manifest } = await loadCharacter(pack({ movement: { walkSpeed: -400, runSpeed: 0 } }));

    // A negative speed walks away from the target; zero never gets there, and
    // the walk callback is what returns the companion to idle.
    expect(manifest.movement.walkSpeed).toBe(60);
    expect(manifest.movement.runSpeed).toBe(140);
  });
});

describe('loadCharacter hitbox and anchor', () => {
  it('keeps the hitbox inside the frame', async () => {
    const { manifest } = await loadCharacter(
      pack({ hitbox: { x: -3, y: -3, width: 50, height: 50 } }),
    );

    expect(manifest.hitbox).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('trims a hitbox that runs off the right of the frame', async () => {
    const { manifest } = await loadCharacter(
      pack({ hitbox: { x: 0.8, y: 0.5, width: 0.9, height: 0.9 } }),
    );

    expect(manifest.hitbox.x + manifest.hitbox.width).toBeCloseTo(1);
    expect(manifest.hitbox.y + manifest.hitbox.height).toBeCloseTo(1);
  });

  it('falls back to the whole frame when the hitbox is too small to click', async () => {
    // The hitbox is the only thing that makes the overlay solid, so a
    // degenerate one costs every click — including the right-click to settings.
    const { manifest } = await loadCharacter(
      pack({ hitbox: { x: 0.5, y: 0.5, width: 0, height: 0 } }),
    );

    expect(manifest.hitbox).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('keeps the full-frame hitbox the stills importer writes', async () => {
    const { manifest } = await loadCharacter(
      pack({ hitbox: { x: 0, y: 0.022, width: 1, height: 0.978 } }),
    );

    expect(manifest.hitbox).toEqual({ x: 0, y: 0.022, width: 1, height: 0.978 });
  });

  it('keeps the anchor inside the frame', async () => {
    const { manifest } = await loadCharacter(pack({ anchor: { x: 9, y: -9 } }));

    expect(manifest.anchor).toEqual({ x: 1, y: 0 });
  });
});

describe('loadCharacter asset paths', () => {
  it('rejects an animation whose frames climb out of the pack', async () => {
    // Frames are pasted onto the pack directory to build an asset URL. The
    // protocol's scope would refuse this, but a pack that cannot name such a
    // path never reaches that argument.
    await expect(
      loadCharacter(
        pack({
          animations: {
            idle: { format: 'png-sequence', frames: ['../../../../etc/passwd'] },
          },
        }),
      ),
    ).rejects.toThrow(/idle/);
  });

  it.each([
    ['an absolute path', '/etc/passwd'],
    ['a Windows separator', '..\\..\\secrets.png'],
    ['a drive letter', 'C:/secrets.png'],
    ['a URL', 'https://example.com/x.png'],
    ['a bare dot segment', 'idle/./01.png'],
  ])('rejects %s as a frame', async (_label, path) => {
    await expect(
      loadCharacter(
        pack({ animations: { idle: { format: 'png-sequence', frames: [path] } } }),
      ),
    ).rejects.toThrow(CharacterLoadError);
  });

  it('allows the subdirectories the bundled pack actually uses', async () => {
    const { manifest } = await loadCharacter(
      pack({
        animations: {
          idle: { format: 'png-sequence', frames: ['idle/001.png', 'idle/002.png'] },
        },
      }),
    );

    expect(manifest.animations['idle']?.frames).toEqual(['idle/001.png', 'idle/002.png']);
  });

  it('drops a still that points outside the pack but keeps the usable ones', async () => {
    const { manifest } = await loadCharacter(
      pack({
        animations: undefined,
        stills: { idle: 'idle.png', happy: '../../../elsewhere.png' },
      }),
    );

    // happy falls back to idle rather than loading the escaping path.
    expect(manifest.animations['idle']?.frames).toEqual(['idle.png']);
    expect(manifest.animations['happy']?.frames).toEqual(['idle.png']);
  });

  it('ignores a thumbnail that points outside the pack', async () => {
    const escaping = await loadCharacter(pack({ thumbnail: '../../../../etc/passwd' }));
    expect(escaping.manifest.thumbnail).toBeUndefined();

    const ordinary = await loadCharacter(pack({ thumbnail: 'thumbnail.png' }));
    expect(ordinary.manifest.thumbnail).toBe('thumbnail.png');
  });
});
