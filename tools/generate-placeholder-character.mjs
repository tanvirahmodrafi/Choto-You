/**
 * Writes the PNG sprite frames and manifests for the bundled avatars.
 *
 * All four are the same ORIGINAL procedural character in different colours.
 * They exist so the avatar picker has stock choices out of the box; the point
 * of the picker is the avatar the user imports.
 *
 * Run with: npm run assets:character
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './png.mjs';
import { ANIMATIONS, FRAME_SIZE, PALETTES, pose, render, usePalette } from './character-art.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHARACTERS = join(ROOT, 'public', 'characters');

/** Written once per pack, with only the identity fields differing. */
function manifest(id, name) {
  const animations = {};
  for (const [animation, def] of Object.entries(ANIMATIONS)) {
    animations[animation] = {
      format: 'png-sequence',
      fps: def.fps ?? FPS[animation] ?? 8,
      loop: LOOPS[animation] ?? true,
      frames: Array.from(
        { length: def.frames },
        (_, i) => `${animation}/${String(i + 1).padStart(3, '0')}.png`,
      ),
    };
  }

  return {
    schemaVersion: 2,
    id,
    name,
    version: '1.0.0',
    author: 'Choto You (original placeholder)',
    license: 'Original artwork, bundled with the application',
    thumbnail: 'thumbnail.png',
    frameSize: { width: FRAME_SIZE, height: FRAME_SIZE },
    defaultScale: 1,
    facing: 'right',
    anchor: { x: 0.5, y: 0.92 },
    hitbox: { x: 0.26, y: 0.2, width: 0.48, height: 0.72 },
    movement: { walkSpeed: 60, runSpeed: 140 },
    animations,
  };
}

/**
 * Per-animation playback, carried over verbatim from the hand-written manifest
 * that shipped before these were generated.
 */
const FPS = {
  idle: 8,
  walk: 12,
  jump: 12,
  fall: 8,
  land: 14,
  happy: 14,
  surprised: 10,
  dragged: 10,
  wave: 10,
  drink: 6,
  sleep: 4,
  wake: 8,
};

const LOOPS = {
  idle: true,
  walk: true,
  jump: false,
  fall: true,
  land: false,
  happy: false,
  surprised: false,
  dragged: true,
  wave: true,
  drink: false,
  sleep: true,
  wake: false,
};

let packs = 0;
let total = 0;

for (const [id, palette] of Object.entries(PALETTES)) {
  usePalette(id);
  const out = join(CHARACTERS, id);
  mkdirSync(out, { recursive: true });

  for (const [name, def] of Object.entries(ANIMATIONS)) {
    const dir = join(out, name);
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < def.frames; i++) {
      const rgba = render(pose(def.pose(i / def.frames, i)));
      writeFileSync(join(dir, `${String(i + 1).padStart(3, '0')}.png`), encodePng(FRAME_SIZE, FRAME_SIZE, rgba));
      total++;
    }
  }

  copyFileSync(join(out, 'idle', '001.png'), join(out, 'thumbnail.png'));
  writeFileSync(join(out, 'character.json'), `${JSON.stringify(manifest(id, palette.name), null, 2)}\n`);
  packs++;
  console.log(`  ${id} (${palette.name}): ${Object.keys(ANIMATIONS).length} animations`);
}

// The frontend needs to know which packs exist without a directory listing,
// which it cannot do over HTTP. An index written here is that listing.
const index = Object.entries(PALETTES).map(([id, palette]) => ({
  id,
  name: palette.name,
  thumbnail: `${id}/thumbnail.png`,
}));
writeFileSync(join(CHARACTERS, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

// Sanity check: a manifest that cannot be read back is a broken build.
for (const { id } of index) {
  JSON.parse(readFileSync(join(CHARACTERS, id, 'character.json'), 'utf8'));
}

console.log(`Wrote ${packs} pack(s), ${total} frames and index.json to ${CHARACTERS}`);
