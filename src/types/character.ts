/**
 * The character-pack format. Versioned so future packs can be loaded without
 * breaking packs authored against an earlier schema.
 *
 * Packs are purely declarative: they contain configuration and assets only,
 * never executable code.
 */
export const CHARACTER_SCHEMA_VERSION = 2;

/**
 * Schema versions this build can load.
 *
 * Version 1 packs declare every animation as a PNG sequence. Version 2 adds the
 * `stills` shorthand, where one image per mood is expanded into the full set of
 * animation slots — which is what an avatar imported from a few drawings uses.
 */
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1, 2];

/**
 * Asset format of an animation. Only `png-sequence` is implemented today;
 * the union exists so the loader can reject unknown formats explicitly
 * instead of failing deep inside the renderer.
 */
export type AnimationFormat = 'png-sequence';

export interface NormalizedRect {
  /** All values are fractions of the frame size, 0..1. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface NormalizedPoint {
  readonly x: number;
  readonly y: number;
}

export interface AnimationDefinition {
  readonly format: AnimationFormat;
  readonly fps: number;
  readonly loop: boolean;
  /** Frame paths, relative to the character pack root. */
  readonly frames: readonly string[];
}

export interface CharacterManifest {
  readonly schemaVersion: number;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly author?: string;
  readonly license?: string;
  readonly thumbnail?: string;
  readonly frameSize: { readonly width: number; readonly height: number };
  readonly defaultScale: number;
  /** Direction the artwork faces natively; the other direction is mirrored. */
  readonly facing: 'left' | 'right';
  /** Where the character's "feet" sit within the frame, used for grounding. */
  readonly anchor: NormalizedPoint;
  /** The clickable/draggable region; transparent padding is excluded. */
  readonly hitbox: NormalizedRect;
  readonly movement: { readonly walkSpeed: number; readonly runSpeed: number };
  readonly animations: Readonly<Record<string, AnimationDefinition>>;
}

/** Where a pack came from, which decides how its assets are addressed. */
export type AvatarOrigin = 'bundled' | 'user';

/**
 * A manifest plus the means of turning its relative asset paths into URLs.
 *
 * Bundled packs are served by the frontend's own origin, so a base URL and
 * string concatenation would do. Packs the user imported live outside the app
 * and are reached through Tauri's asset protocol, which encodes the whole
 * absolute path into one opaque URL — appending to it would not work. A
 * resolver function covers both without the renderer needing to know which it
 * is holding.
 */
export interface LoadedCharacter {
  readonly manifest: CharacterManifest;
  readonly origin: AvatarOrigin;
  readonly resolve: (relativePath: string) => string;
}

/** Resolves a pack-relative asset path to a URL the renderer can load. */
export function resolveAssetUrl(character: LoadedCharacter, relativePath: string): string {
  return character.resolve(relativePath.replace(/^\//, ''));
}
