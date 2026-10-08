import {
  SUPPORTED_SCHEMA_VERSIONS,
  type AnimationDefinition,
  type AvatarOrigin,
  type CharacterManifest,
  type LoadedCharacter,
  type NormalizedPoint,
  type NormalizedRect,
} from '@/types/character';
import { createLogger } from '@/utils/logger';
import { expandStills } from './stills';

const log = createLogger('CHARACTER');

export class CharacterLoadError extends Error {
  constructor(
    message: string,
    readonly characterId: string,
  ) {
    super(message);
    this.name = 'CharacterLoadError';
  }
}

/** Bundled packs live under `public/characters/<id>/character.json`. */
export function bundledCharacterUrl(id: string): string {
  return `/characters/${id}`;
}

/**
 * Everything the loader needs to find a pack.
 *
 * A bundled pack is fetched from the app's own origin. A user pack has already
 * been read off disk by the Rust side — its manifest text comes with the
 * reference — and its assets are addressed through a resolver that the avatar
 * registry builds from the asset protocol.
 */
export interface AvatarRef {
  readonly id: string;
  readonly origin: AvatarOrigin;
  /** Turns a pack-relative path into a URL the webview can load. */
  readonly resolve: (relativePath: string) => string;
  /** The manifest, already read. Omitted for bundled packs, which are fetched. */
  readonly manifestText?: string;
  /**
   * The id the manifest is expected to declare, when that differs from `id`.
   *
   * A user pack's `id` carries a namespace prefix so it cannot collide with a
   * bundled one, but the manifest on disk names the bare directory. Without
   * this the two would never match and every load would warn.
   */
  readonly manifestId?: string;
}

/** A bundled pack, addressed by directory name under `public/characters`. */
export function bundledAvatar(id: string): AvatarRef {
  const baseUrl = bundledCharacterUrl(id);
  return {
    id,
    origin: 'bundled',
    resolve: (relativePath) => `${baseUrl}/${relativePath}`,
  };
}

export async function loadCharacter(ref: AvatarRef | string): Promise<LoadedCharacter> {
  const avatar = typeof ref === 'string' ? bundledAvatar(ref) : ref;
  const { id } = avatar;

  let raw: unknown;
  if (avatar.manifestText !== undefined) {
    try {
      raw = JSON.parse(avatar.manifestText);
    } catch (cause) {
      throw new CharacterLoadError(`Manifest is not valid JSON: ${describe(cause)}`, id);
    }
  } else {
    try {
      const response = await fetch(avatar.resolve('character.json'));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      raw = await response.json();
    } catch (cause) {
      throw new CharacterLoadError(
        `Could not read character manifest: ${describe(cause)}`,
        id,
      );
    }
  }

  const manifest = validateManifest(raw, id, avatar.manifestId ?? id);
  log.info(`Loaded character "${manifest.name}" v${manifest.version}`, {
    animations: Object.keys(manifest.animations),
    origin: avatar.origin,
  });
  return { manifest, origin: avatar.origin, resolve: avatar.resolve };
}

// --- validation -----------------------------------------------------------
// A pack is untrusted input: every field is checked before it reaches the
// renderer, so a corrupt manifest produces one clear error rather than a
// cascade of undefined-property failures later.
//
// Types alone are not enough for the fields that end up as window geometry.
// The app's own importers always write sane values, but a pack directory is an
// ordinary folder in the app data directory that anything can write, and a
// manifest from a future build may hold values this one does not expect. The
// bounds below are generous next to what the real packs use (frames of 221-256
// px at scales of 0.46-0.54, speeds of 55-70) and exist only to keep an absurd
// value from producing a companion that cannot be seen or clicked.

/** The largest frame dimension worth honouring, in pixels. */
const MAX_FRAME_PX = 4096;
const MIN_SCALE = 0.05;
const MAX_SCALE = 4;
/** Logical points per second. */
const MIN_SPEED = 1;
const MAX_SPEED = 1000;
/** Smallest clickable hitbox, as a fraction of the frame. */
const MIN_HITBOX = 0.02;

function validateManifest(raw: unknown, id: string, expectedId: string): CharacterManifest {
  if (!isRecord(raw)) throw new CharacterLoadError('Manifest is not an object', id);

  const schemaVersion = requireNumber(raw['schemaVersion'], 'schemaVersion', id);
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(schemaVersion)) {
    throw new CharacterLoadError(
      `Unsupported schemaVersion ${schemaVersion}; this build supports ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`,
      id,
    );
  }

  const manifestId = requireString(raw['id'], 'id', id);
  if (manifestId !== expectedId) {
    log.warn(`Manifest id "${manifestId}" does not match directory "${expectedId}"`);
  }

  const frameSize = requireRecord(raw['frameSize'], 'frameSize', id);
  const thumbnail = assetPath(raw['thumbnail']);

  // A pack declares either full sequences, the `stills` shorthand, or both. The
  // shorthand is expanded first so an explicit sequence for the same slot wins:
  // a pack that starts as stills can gain real animation one slot at a time.
  const parsedAnimations: Record<string, AnimationDefinition> = {};

  const stills = raw['stills'];
  if (isRecord(stills)) {
    const paths: Record<string, string> = {};
    for (const [slot, value] of Object.entries(stills)) {
      const path = assetPath(value);
      if (path) {
        paths[slot] = path;
      } else if (value !== undefined) {
        log.warn(`Still "${slot}" in character "${id}" is not a usable pack path; skipping`);
      }
    }
    const expanded = expandStills(paths);
    if (!expanded) {
      throw new CharacterLoadError('A stills pack must provide at least an "idle" image', id);
    }
    Object.assign(parsedAnimations, expanded);
  }

  if (raw['animations'] !== undefined) {
    const animations = requireRecord(raw['animations'], 'animations', id);
    for (const [name, value] of Object.entries(animations)) {
      const animation = parseAnimation(value, name, id);
      if (animation) parsedAnimations[name] = animation;
    }
  }

  if (!parsedAnimations['idle']) {
    throw new CharacterLoadError('Manifest defines no usable "idle" animation', id);
  }

  const movement = requireRecord(raw['movement'], 'movement', id);
  const facing = raw['facing'] === 'left' ? 'left' : 'right';

  return {
    schemaVersion,
    id: manifestId,
    name: requireString(raw['name'], 'name', id),
    version: requireString(raw['version'], 'version', id),
    ...(typeof raw['author'] === 'string' ? { author: raw['author'] } : {}),
    ...(typeof raw['license'] === 'string' ? { license: raw['license'] } : {}),
    ...(thumbnail ? { thumbnail } : {}),
    frameSize: {
      width: requireFrameExtent(frameSize['width'], 'frameSize.width', id),
      height: requireFrameExtent(frameSize['height'], 'frameSize.height', id),
    },
    defaultScale: positiveNumber(raw['defaultScale'], 1, MIN_SCALE, MAX_SCALE),
    facing,
    anchor: parsePoint(raw['anchor'], { x: 0.5, y: 1 }),
    hitbox: parseHitbox(raw['hitbox']),
    movement: {
      walkSpeed: positiveNumber(movement['walkSpeed'], 60, MIN_SPEED, MAX_SPEED),
      runSpeed: positiveNumber(movement['runSpeed'], 140, MIN_SPEED, MAX_SPEED),
    },
    animations: parsedAnimations,
  };
}

/** Returns null for an unusable animation so one bad entry cannot kill a pack. */
function parseAnimation(value: unknown, name: string, id: string): AnimationDefinition | null {
  if (!isRecord(value)) {
    log.warn(`Animation "${name}" in character "${id}" is not an object; skipping`);
    return null;
  }
  if (value['format'] !== 'png-sequence') {
    log.warn(`Animation "${name}" uses unsupported format "${String(value['format'])}"; skipping`);
    return null;
  }
  const frames = value['frames'];
  if (!Array.isArray(frames) || frames.length === 0) {
    log.warn(`Animation "${name}" in character "${id}" has no valid frames; skipping`);
    return null;
  }

  // Every frame must still be inside the pack. A path is pasted onto the pack
  // directory to build an asset URL, so one that climbs out of it with `..`, or
  // names an absolute location, would point the renderer at a file that has
  // nothing to do with this avatar. The asset protocol's scope would refuse it,
  // but a pack that cannot describe such a path in the first place never
  // reaches that argument.
  const paths: string[] = [];
  for (const frame of frames) {
    const path = assetPath(frame);
    if (!path) {
      log.warn(
        `Animation "${name}" in character "${id}" names a frame outside the pack; skipping`,
      );
      return null;
    }
    paths.push(path);
  }

  return {
    format: 'png-sequence',
    fps: clamp(optionalNumber(value['fps'], 8), 1, 60),
    loop: value['loop'] !== false,
    frames: paths,
  };
}

/** Anchor and hitbox are fractions of the frame, so they belong in 0..1. */
function parsePoint(value: unknown, fallback: NormalizedPoint): NormalizedPoint {
  if (!isRecord(value)) return fallback;
  return {
    x: clamp(optionalNumber(value['x'], fallback.x), 0, 1),
    y: clamp(optionalNumber(value['y'], fallback.y), 0, 1),
  };
}

/**
 * Reads the clickable area, keeping it inside the frame and big enough to hit.
 *
 * The hitbox is the only thing that makes the overlay solid, so a degenerate
 * one costs the user every click, drag and right-click on their companion —
 * including the right-click that opens settings. A box that cannot be hit is
 * therefore replaced by the whole frame rather than honoured.
 */
function parseHitbox(value: unknown): NormalizedRect {
  const whole: NormalizedRect = { x: 0, y: 0, width: 1, height: 1 };
  if (!isRecord(value)) return whole;

  const x = clamp(optionalNumber(value['x'], whole.x), 0, 1);
  const y = clamp(optionalNumber(value['y'], whole.y), 0, 1);
  const width = clamp(optionalNumber(value['width'], whole.width), 0, 1 - x);
  const height = clamp(optionalNumber(value['height'], whole.height), 0, 1 - y);

  if (width < MIN_HITBOX || height < MIN_HITBOX) {
    log.warn('Hitbox is too small to click; using the whole frame instead');
    return whole;
  }
  return { x, y, width, height };
}

// --- primitives -----------------------------------------------------------
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, field: string, id: string): Record<string, unknown> {
  if (!isRecord(value)) throw new CharacterLoadError(`Field "${field}" must be an object`, id);
  return value;
}

function requireString(value: unknown, field: string, id: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CharacterLoadError(`Field "${field}" must be a non-empty string`, id);
  }
  return value;
}

function requireNumber(value: unknown, field: string, id: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CharacterLoadError(`Field "${field}" must be a finite number`, id);
  }
  return value;
}

function optionalNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * A frame dimension, which must be a real number of pixels.
 *
 * This and `defaultScale` are multiplied together to size the overlay window,
 * so zero or a negative produces a window that cannot be seen or clicked, and
 * an enormous one produces a window that covers the screen. Neither is
 * recoverable by pointing at the companion, which is why the bounds are here
 * rather than left to the renderer.
 */
function requireFrameExtent(value: unknown, field: string, id: string): number {
  const extent = requireNumber(value, field, id);
  if (extent <= 0) {
    throw new CharacterLoadError(`Field "${field}" must be greater than zero`, id);
  }
  return Math.min(extent, MAX_FRAME_PX);
}

/** A value that is only meaningful above zero; anything else takes the default. */
function positiveNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = optionalNumber(value, fallback);
  // A speed or scale of zero is worse than a wrong one: a walk at zero speed
  // never arrives, and a scale of zero draws nothing at all.
  if (number <= 0) return fallback;
  return clamp(number, min, max);
}

/**
 * A path inside the pack, or null if it is not one.
 *
 * Paths are joined onto the pack directory, and the bundled pack legitimately
 * uses subdirectories (`idle/001.png`), so separators are allowed and each
 * segment is checked instead. Rejected: absolute paths, `.`/`..` segments,
 * Windows separators and drive letters, URL schemes, and anything with a NUL.
 */
function assetPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (path.length === 0 || path.length > 255) return null;
  if (path.startsWith('/') || path.includes('\\') || path.includes(':') || path.includes('\0')) {
    return null;
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return null;
  }
  return path;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
