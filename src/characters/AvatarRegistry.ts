import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { CharacterManifest } from '@/types/character';
import { createLogger } from '@/utils/logger';
import { bundledAvatar, loadCharacter, type AvatarRef } from './CharacterLoader';
import {
  ANIMATION_SLOTS,
  expandStills,
  fillAnimationSlots,
  type AnimationSlot,
} from './stills';
import {
  SHEET_PLAN,
  TARGET_CHARACTER_HEIGHT,
  type SheetRow,
} from './avatarSheet';
import type { AnimationDefinition } from '@/types/character';
import type { Bounds } from './pixels';

const log = createLogger('CHARACTER');

/** Pack the app falls back to when the chosen avatar cannot be loaded. */
export const DEFAULT_AVATAR_ID = 'pip';

/**
 * Written by `npm run assets:character`. A webview cannot list a directory over
 * HTTP, so the bundled packs announce themselves in a file.
 */
const BUNDLED_INDEX_URL = '/characters/index.json';

/** Prefix that distinguishes a user pack's id from a bundled one. */
const USER_PREFIX = 'user:';

export interface AvatarSummary {
  /** The id stored in settings. User packs are prefixed, so the two namespaces cannot collide. */
  readonly id: string;
  readonly name: string;
  readonly origin: 'bundled' | 'user';
  /** A URL the settings window can put in an `<img>`, or null if the pack has none. */
  readonly thumbnailUrl: string | null;
  /** Which animation slots the pack actually has artwork for. */
  readonly slots: readonly string[];
}

/** Shape returned by the `list_user_avatars` command. */
interface UserAvatarRecord {
  readonly id: string;
  readonly directory: string;
  readonly manifest: string;
  /** Epoch millis the pack was last written; used to defeat the asset cache. */
  readonly modified: number;
}

/** One still chosen for a slot during an import. */
export interface StillUpload {
  readonly slot: AnimationSlot;
  /** Lowercase extension without the dot. */
  readonly extension: string;
  /** Base64, without a data-URL prefix. */
  readonly data: string;
}

/**
 * Knows every avatar the app can show, bundled or imported.
 *
 * Both windows need this: the overlay to load the chosen pack, the settings
 * window to list them. It holds no state beyond a cache of the last listing, so
 * each window can have its own instance.
 */
export class AvatarRegistry {
  private cache: readonly AvatarSummary[] | null = null;

  /** True for an id that names a pack the user imported. */
  static isUserAvatar(id: string): boolean {
    return id.startsWith(USER_PREFIX);
  }

  static userAvatarId(directoryName: string): string {
    return `${USER_PREFIX}${directoryName}`;
  }

  /** The directory name behind a prefixed id. */
  static directoryName(id: string): string {
    return id.startsWith(USER_PREFIX) ? id.slice(USER_PREFIX.length) : id;
  }

  /**
   * Resolves a stored avatar id to something the loader can open.
   *
   * Returns null when the id names a user pack that is no longer on disk — the
   * caller then falls back to the default rather than showing nothing.
   */
  async resolve(id: string): Promise<AvatarRef | null> {
    if (!AvatarRegistry.isUserAvatar(id)) return bundledAvatar(id);

    const directoryName = AvatarRegistry.directoryName(id);
    const record = (await this.readUserRecords()).find((entry) => entry.id === directoryName);
    if (!record) {
      log.warn(`Imported avatar "${directoryName}" is no longer on disk`);
      return null;
    }
    return userAvatarRef(record);
  }

  /** Lists every avatar, bundled first. */
  async list(options: { readonly refresh?: boolean } = {}): Promise<readonly AvatarSummary[]> {
    if (this.cache && options.refresh !== true) return this.cache;

    const [bundled, user] = await Promise.all([this.listBundled(), this.listUser()]);
    const all = [...bundled, ...user];
    this.cache = all;
    return all;
  }

  /**
   * Writes a new user pack built from still images.
   *
   * The manifest is composed here rather than in Rust because the pack schema
   * belongs to the frontend; Rust only owns the filesystem.
   */
  async saveStillAvatar(options: {
    readonly directoryName: string;
    readonly displayName: string;
    readonly stills: readonly StillUpload[];
  }): Promise<string> {
    const { directoryName, displayName, stills } = options;

    if (!stills.some((still) => still.slot === 'idle')) {
      throw new Error('An avatar needs at least a "Normal" image.');
    }

    const paths: Record<string, string> = {};
    for (const still of stills) {
      paths[still.slot] = `${still.slot}.${still.extension}`;
    }

    // Validate before writing anything: a pack whose stills cannot be expanded
    // would be saved and then refuse to load.
    if (!expandStills(paths)) {
      throw new Error('These images could not be made into an avatar.');
    }

    const manifest = {
      schemaVersion: 2,
      id: directoryName,
      name: displayName,
      version: '1.0.0',
      author: 'Imported by the user',
      license: 'Supplied by the user',
      thumbnail: paths['idle'],
      // Stills are drawn into a square box; the renderer scales to fit, so this
      // is a layout hint rather than the images' real pixel size.
      frameSize: { width: 96, height: 96 },
      defaultScale: 1,
      facing: 'right',
      anchor: { x: 0.5, y: 0.96 },
      // A hand-drawn still usually fills more of its frame than a sprite does,
      // and a hitbox that is too tight makes the avatar hard to grab.
      hitbox: { x: 0.12, y: 0.06, width: 0.76, height: 0.9 },
      movement: { walkSpeed: 55, runSpeed: 120 },
      stills: paths,
    };

    await invoke('save_user_avatar', {
      id: directoryName,
      manifest: JSON.stringify(manifest, null, 2),
      images: stills.map((still) => ({
        slot: still.slot,
        extension: still.extension,
        data: still.data,
      })),
    });

    this.cache = null;
    log.info(`Imported avatar "${displayName}"`);
    return AvatarRegistry.userAvatarId(directoryName);
  }

  /**
   * Writes a user pack from the cells of a sliced sprite sheet.
   *
   * Unlike a stills pack, this one has real sequences: `idle`, `walk` and
   * `wave` each keep their eight frames, which is what makes the character's
   * legs and arms actually move. The remaining slots borrow along the usual
   * fallback chains.
   *
   * @param cells Base64 PNGs in grid order, as `sliceSheet` produced them.
   *   Cells the slicer found blank are skipped, so a sheet the model only
   *   partly filled still yields a working avatar.
   */
  async saveSheetAvatar(options: {
    readonly directoryName: string;
    readonly displayName: string;
    readonly cells: readonly { readonly index: number; readonly data: string; readonly isEmpty: boolean }[];
    readonly cellWidth: number;
    readonly cellHeight: number;
    /** Measured artwork bounds, in pixels, if the slicer could find any. */
    readonly contentBounds?: Bounds | null;
    /** Measured feet position as a fraction of the cell. */
    readonly baselineY?: number | null;
  }): Promise<string> {
    const { directoryName, displayName, cells, cellWidth, cellHeight } = options;

    const byIndex = new Map(cells.map((cell) => [cell.index, cell]));
    const images: { slot: string; extension: string; data: string }[] = [];
    const provided: Record<string, AnimationDefinition> = {};

    let cursor = 0;
    for (const row of SHEET_PLAN) {
      const count = rowCellCount(row);
      const slice = Array.from({ length: count }, (_, offset) => byIndex.get(cursor + offset));
      cursor += count;

      if (row.kind === 'sequence') {
        const frames: string[] = [];
        for (const [position, cell] of slice.entries()) {
          if (!cell || cell.isEmpty) continue;
          // Flat names, not subdirectories: the save command treats each name
          // as a single path segment, which is what keeps it unable to write
          // outside the pack.
          const name = `${row.slot}-${String(position + 1).padStart(2, '0')}`;
          images.push({ slot: name, extension: 'png', data: cell.data });
          frames.push(`${name}.png`);
        }
        if (frames.length > 0) {
          provided[row.slot] = { format: 'png-sequence', fps: row.fps, loop: true, frames };
        }
        continue;
      }

      for (const [position, cell] of slice.entries()) {
        const plan = row.cells[position];
        if (!plan || !cell || cell.isEmpty) continue;
        images.push({ slot: plan.slot, extension: 'png', data: cell.data });
        provided[plan.slot] = {
          format: 'png-sequence',
          fps: 1,
          loop: true,
          frames: [`${plan.slot}.png`],
        };
      }
    }

    const animations = fillAnimationSlots(provided);
    if (!animations) {
      throw new Error(
        'The first row of that sheet came out blank, so there is no standing pose to build on.',
      );
    }

    // Cells are far bigger than the character should appear, so the pack's own
    // scale brings it down to roughly the size of the bundled avatars.
    const defaultScale =
      Math.round((TARGET_CHARACTER_HEIGHT / Math.max(cellHeight, 1)) * 1000) / 1000;

    // Measured from the artwork where possible rather than assumed. A model
    // leaves whatever margin it likes below the feet, and a guessed anchor makes
    // the character hover above the dock or sink through it.
    const anchorY = clamp(options.baselineY ?? 0.94, 0.5, 1);
    const hitbox = hitboxFrom(options.contentBounds ?? null, cellWidth, cellHeight);

    const manifest = {
      schemaVersion: 2,
      id: directoryName,
      name: displayName,
      version: '1.0.0',
      author: 'Imported by the user',
      license: 'Supplied by the user',
      thumbnail: animations['idle']?.frames[0] ?? 'idle-01.png',
      frameSize: { width: cellWidth, height: cellHeight },
      defaultScale,
      facing: 'right',
      anchor: { x: 0.5, y: anchorY },
      hitbox,
      movement: { walkSpeed: 55, runSpeed: 120 },
      animations,
    };

    await invoke('save_user_avatar', {
      id: directoryName,
      manifest: JSON.stringify(manifest, null, 2),
      images,
    });

    this.cache = null;
    log.info(`Imported animated avatar "${displayName}"`, {
      frames: images.length,
      cell: `${cellWidth}x${cellHeight}`,
    });
    return AvatarRegistry.userAvatarId(directoryName);
  }

  async deleteUserAvatar(id: string): Promise<void> {
    await invoke('delete_user_avatar', { id: AvatarRegistry.directoryName(id) });
    this.cache = null;
  }

  private async listBundled(): Promise<readonly AvatarSummary[]> {
    let entries: unknown;
    try {
      const response = await fetch(BUNDLED_INDEX_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      entries = await response.json();
    } catch (error) {
      log.error('Could not read the bundled avatar index', error);
      // The default pack is always present in the bundle, so naming it directly
      // keeps the picker usable even with a missing or corrupt index.
      return [
        {
          id: DEFAULT_AVATAR_ID,
          name: 'Pip',
          origin: 'bundled',
          thumbnailUrl: `/characters/${DEFAULT_AVATAR_ID}/thumbnail.png`,
          slots: [...ANIMATION_SLOTS],
        },
      ];
    }

    if (!Array.isArray(entries)) return [];

    const summaries: AvatarSummary[] = [];
    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as Record<string, unknown>;
      const id = typeof record['id'] === 'string' ? record['id'] : null;
      if (!id) continue;
      summaries.push({
        id,
        name: typeof record['name'] === 'string' ? record['name'] : id,
        origin: 'bundled',
        thumbnailUrl:
          typeof record['thumbnail'] === 'string' ? `/characters/${record['thumbnail']}` : null,
        slots: [...ANIMATION_SLOTS],
      });
    }
    return summaries;
  }

  private async listUser(): Promise<readonly AvatarSummary[]> {
    const summaries: AvatarSummary[] = [];
    for (const record of await this.readUserRecords()) {
      // Load through the real loader rather than trusting the stored JSON, so a
      // pack that would fail at runtime is not offered in the picker.
      let manifest: CharacterManifest;
      try {
        manifest = (await loadCharacter(userAvatarRef(record))).manifest;
      } catch (error) {
        log.warn(`Imported avatar "${record.id}" could not be loaded; hiding it`, error);
        continue;
      }
      summaries.push({
        id: AvatarRegistry.userAvatarId(record.id),
        name: manifest.name,
        origin: 'user',
        thumbnailUrl: manifest.thumbnail ? versioned(record, manifest.thumbnail) : null,
        slots: Object.keys(manifest.animations),
      });
    }
    return summaries;
  }

  private async readUserRecords(): Promise<readonly UserAvatarRecord[]> {
    try {
      return await invoke<UserAvatarRecord[]>('list_user_avatars');
    } catch (error) {
      log.error('Could not list imported avatars', error);
      return [];
    }
  }
}

/**
 * Builds a loader reference for a pack on disk.
 *
 * Each asset is converted individually: the asset protocol encodes a whole
 * absolute path into one URL, so there is no base URL to append to.
 */
function userAvatarRef(record: UserAvatarRecord): AvatarRef {
  return {
    id: AvatarRegistry.userAvatarId(record.id),
    origin: 'user',
    resolve: (relativePath) => versioned(record, relativePath),
    manifestText: record.manifest,
    // The manifest names the directory, not the namespaced id.
    manifestId: record.id,
  };
}

/**
 * An asset URL that changes whenever the pack is rewritten.
 *
 * Re-importing an avatar replaces its images at the same paths, so without this
 * the URLs are identical and the webview serves the copies it already holds:
 * the user corrects their sprite sheet, imports it again, and is shown exactly
 * the frames they were trying to replace.
 */
function versioned(record: UserAvatarRecord, relativePath: string): string {
  const url = convertFileSrc(`${record.directory}/${relativePath}`);
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${record.modified}`;
}


/** How many grid cells a planned row consumes. */
function rowCellCount(row: SheetRow): number {
  return row.cells.length;
}


/**
 * Turns measured artwork bounds into a normalised hitbox.
 *
 * The box is what the user has to hit to grab the character, so it is padded
 * slightly outwards: a hitbox fitted exactly to the pixels makes a character
 * with thin limbs or a trailing scarf frustrating to pick up. Falls back to a
 * generous default when nothing could be measured.
 */
function hitboxFrom(
  bounds: Bounds | null,
  cellWidth: number,
  cellHeight: number,
): { x: number; y: number; width: number; height: number } {
  if (!bounds || cellWidth <= 0 || cellHeight <= 0) {
    return { x: 0.15, y: 0.05, width: 0.7, height: 0.92 };
  }

  const padX = cellWidth * 0.02;
  const padY = cellHeight * 0.02;
  const left = clamp((bounds.left - padX) / cellWidth, 0, 1);
  const top = clamp((bounds.top - padY) / cellHeight, 0, 1);
  const right = clamp((bounds.right + padX) / cellWidth, 0, 1);
  const bottom = clamp((bounds.bottom + padY) / cellHeight, 0, 1);

  return {
    x: round(left),
    y: round(top),
    width: round(Math.max(right - left, 0.1)),
    height: round(Math.max(bottom - top, 0.1)),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Three decimals keeps the manifest readable without losing anything visible. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
