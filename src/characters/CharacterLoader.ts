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

  // A pack declares either full sequences, the `stills` shorthand, or both. The
  // shorthand is expanded first so an explicit sequence for the same slot wins:
  // a pack that starts as stills can gain real animation one slot at a time.
  const parsedAnimations: Record<string, AnimationDefinition> = {};

  const stills = raw['stills'];
  if (isRecord(stills)) {
    const paths: Record<string, string> = {};
    for (const [slot, value] of Object.entries(stills)) {
      if (typeof value === 'string' && value.length > 0) paths[slot] = value;
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
    ...(typeof raw['thumbnail'] === 'string' ? { thumbnail: raw['thumbnail'] } : {}),
    frameSize: {
      width: requireNumber(frameSize['width'], 'frameSize.width', id),
      height: requireNumber(frameSize['height'], 'frameSize.height', id),
    },
    defaultScale: optionalNumber(raw['defaultScale'], 1),
    facing,
    anchor: parsePoint(raw['anchor'], { x: 0.5, y: 1 }),
    hitbox: parseRect(raw['hitbox'], { x: 0, y: 0, width: 1, height: 1 }),
    movement: {
      walkSpeed: optionalNumber(movement['walkSpeed'], 60),
      runSpeed: optionalNumber(movement['runSpeed'], 140),
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
  if (!Array.isArray(frames) || frames.length === 0 || !frames.every((f) => typeof f === 'string')) {
    log.warn(`Animation "${name}" in character "${id}" has no valid frames; skipping`);
    return null;
  }
  return {
    format: 'png-sequence',
    fps: clamp(optionalNumber(value['fps'], 8), 1, 60),
    loop: value['loop'] !== false,
    frames: frames as readonly string[],
  };
}

function parsePoint(value: unknown, fallback: NormalizedPoint): NormalizedPoint {
  if (!isRecord(value)) return fallback;
  return { x: optionalNumber(value['x'], fallback.x), y: optionalNumber(value['y'], fallback.y) };
}

function parseRect(value: unknown, fallback: NormalizedRect): NormalizedRect {
  if (!isRecord(value)) return fallback;
  return {
    x: optionalNumber(value['x'], fallback.x),
    y: optionalNumber(value['y'], fallback.y),
    width: optionalNumber(value['width'], fallback.width),
    height: optionalNumber(value['height'], fallback.height),
  };
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
