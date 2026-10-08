import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AvatarRegistry,
  DEFAULT_AVATAR_ID,
  type AvatarSummary,
  type StillUpload,
} from '@/characters/AvatarRegistry';
import { SUGGESTED_SLOTS, type AnimationSlot } from '@/characters/stills';
import { buildAvatarPrompt, PROMPT_STEPS } from '@/characters/avatarPrompt';
import { SHEET_COLUMNS, SHEET_ROWS, sheetCellPlan } from '@/characters/avatarSheet';
import { sliceSheet, type SliceResult } from '@/characters/sliceSheet';
import { createLogger } from '@/utils/logger';
import { Button } from './Controls';

const log = createLogger('CHARACTER');

/** Extensions the importer accepts, matching what the Rust side allows. */
const ACCEPTED = '.png,.gif,.webp,.jpg,.jpeg';

/**
 * Chooses the avatar on the desktop, and imports new ones.
 *
 * Importing is built around still images on purpose: a hand-drawn avatar
 * arrives as a few pictures, not as sprite sequences, and the pack loader fills
 * in the poses that were not supplied. One picture is enough to start.
 */
export function AvatarPicker({
  selectedId,
  onSelect,
  onArtworkChanged,
}: {
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
  /** Called when a pack's files are written or removed, so the overlay reloads. */
  readonly onArtworkChanged: () => void;
}) {
  const registry = useRegistry();
  const [avatars, setAvatars] = useState<readonly AvatarSummary[]>([]);
  const [importing, setImporting] = useState<'sheet' | 'stills' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setAvatars(await registry.list({ refresh: true }));
    } catch (cause) {
      log.error('Could not list avatars', cause);
      setError('Could not read the list of avatars.');
    }
  }, [registry]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = useCallback(
    async (avatar: AvatarSummary) => {
      setBusy(true);
      setError(null);
      try {
        await registry.deleteUserAvatar(avatar.id);
        onArtworkChanged();
        // Nothing may be left selected pointing at a pack that is gone.
        if (avatar.id === selectedId) onSelect(DEFAULT_AVATAR_ID);
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [onSelect, refresh, registry, selectedId],
  );

  return (
    <div className="avatars">
      {error ? <p className="avatars__error">{error}</p> : null}

      <ul className="avatars__grid">
        {avatars.map((avatar) => (
          <li key={avatar.id}>
            <button
              type="button"
              className="avatar"
              data-selected={avatar.id === selectedId ? 'true' : 'false'}
              onClick={() => onSelect(avatar.id)}
              aria-pressed={avatar.id === selectedId}
            >
              <span className="avatar__frame">
                {avatar.thumbnailUrl ? (
                  <img src={avatar.thumbnailUrl} alt="" className="avatar__image" />
                ) : (
                  <span className="avatar__placeholder" aria-hidden="true" />
                )}
              </span>
              <span className="avatar__name">{avatar.name}</span>
              <span className="avatar__meta">
                {avatar.origin === 'user' ? `Yours · ${avatar.slots.length} poses` : 'Built in'}
              </span>
            </button>
            {avatar.origin === 'user' ? (
              <button
                type="button"
                className="avatar__delete"
                disabled={busy}
                onClick={() => void remove(avatar)}
              >
                Delete
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {importing === 'sheet' ? (
        <AnimatedImportForm
          registry={registry}
          existingIds={avatars.map((avatar) => avatar.id)}
          onCancel={() => setImporting(null)}
          onSaved={async (id) => {
            setImporting(null);
            await refresh();
            onArtworkChanged();
            onSelect(id);
          }}
        />
      ) : importing === 'stills' ? (
        <AvatarImportForm
          registry={registry}
          existingIds={avatars.map((avatar) => avatar.id)}
          onCancel={() => setImporting(null)}
          onSaved={async (id) => {
            setImporting(null);
            await refresh();
            onArtworkChanged();
            onSelect(id);
          }}
        />
      ) : (
        <div className="avatars__actions">
          <Button onClick={() => setImporting('sheet')}>Make one from a photo…</Button>
          <Button onClick={() => setImporting('stills')}>Add still pictures…</Button>
        </div>
      )}
    </div>
  );
}

/** One instance per mount; the registry caches its listing. */
function useRegistry(): AvatarRegistry {
  const ref = useRef<AvatarRegistry | null>(null);
  ref.current ??= new AvatarRegistry();
  return ref.current;
}

/** A still chosen in the form, held with a preview URL until it is saved. */
interface PendingStill extends StillUpload {
  readonly previewUrl: string;
  readonly fileName: string;
}

function AvatarImportForm({
  registry,
  existingIds,
  onCancel,
  onSaved,
}: {
  readonly registry: AvatarRegistry;
  readonly existingIds: readonly string[];
  readonly onCancel: () => void;
  readonly onSaved: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [stills, setStills] = useState<Readonly<Partial<Record<AnimationSlot, PendingStill>>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Object URLs are a finite resource; release them when the form goes away.
  useEffect(
    () => () => {
      for (const still of Object.values(stills)) {
        if (still) URL.revokeObjectURL(still.previewUrl);
      }
    },
    [stills],
  );

  const choose = useCallback(async (slot: AnimationSlot, file: File | null) => {
    if (!file) return;
    setError(null);
    try {
      const still = await readStill(slot, file);
      setStills((current) => {
        const previous = current[slot];
        if (previous) URL.revokeObjectURL(previous.previewUrl);
        return { ...current, [slot]: still };
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const save = useCallback(async () => {
    const chosen = Object.values(stills).filter((still): still is PendingStill => Boolean(still));
    const displayName = name.trim();

    if (!displayName) {
      setError('Give your avatar a name.');
      return;
    }
    if (!chosen.some((still) => still.slot === 'idle')) {
      setError('A "Normal" image is required — it is what stands on the desktop.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const id = await registry.saveStillAvatar({
        directoryName: uniqueDirectoryName(displayName, existingIds),
        displayName,
        stills: chosen.map(({ slot, extension, data }) => ({ slot, extension, data })),
      });
      await onSaved(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }, [existingIds, name, onSaved, registry, stills]);

  return (
    <div className="import">
      <h3 className="import__title">Add your own avatar</h3>
      <p className="import__hint">
        One picture per mood. PNG with a transparent background looks best. Only
        &ldquo;Normal&rdquo; is required — anything you skip reuses the closest picture you did
        provide.
      </p>

      <label className="import__name">
        <span>Name</span>
        <input
          type="text"
          value={name}
          maxLength={40}
          placeholder="Mini me"
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </label>

      <ul className="import__slots">
        {SUGGESTED_SLOTS.map(({ slot, label, hint }) => {
          const still = stills[slot];
          return (
            <li key={slot} className="import__slot">
              <span className="import__frame">
                {still ? (
                  <img src={still.previewUrl} alt="" className="import__preview" />
                ) : (
                  <span className="import__empty" aria-hidden="true" />
                )}
              </span>
              <div className="import__text">
                <span className="import__label">
                  {label}
                  {slot === 'idle' ? <em className="import__required"> required</em> : null}
                </span>
                <span className="import__slotHint">{hint}</span>
                {still ? <span className="import__file">{still.fileName}</span> : null}
              </div>
              <label className="import__choose">
                {still ? 'Replace' : 'Choose'}
                <input
                  type="file"
                  accept={ACCEPTED}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0] ?? null;
                    // Clear the input so re-picking the same file fires again.
                    event.currentTarget.value = '';
                    void choose(slot, file);
                  }}
                />
              </label>
            </li>
          );
        })}
      </ul>

      {error ? <p className="import__error">{error}</p> : null}

      <div className="import__actions">
        <Button onClick={() => void save()}>{saving ? 'Saving…' : 'Save avatar'}</Button>
        <Button tone="danger" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Largest still accepted, matching the ceiling the Rust command enforces. */
const MAX_STILL_BYTES = 8 * 1024 * 1024;

/**
 * Reads a chosen file into the form.
 *
 * Base64 rather than a path: the settings window gets a `File` from the input,
 * never a location on disk, and sending the bytes means the import works the
 * same for a file dragged in from anywhere.
 */
async function readStill(slot: AnimationSlot, file: File): Promise<PendingStill> {
  if (file.size === 0) throw new Error(`"${file.name}" is empty.`);
  if (file.size > MAX_STILL_BYTES) {
    throw new Error(`"${file.name}" is larger than ${MAX_STILL_BYTES / (1024 * 1024)} MB.`);
  }

  const extension = normalizeExtension(file.name);
  if (!extension) {
    throw new Error(`"${file.name}" is not a PNG, GIF, WebP or JPEG.`);
  }

  const buffer = await file.arrayBuffer();
  return {
    slot,
    extension,
    data: toBase64(new Uint8Array(buffer)),
    previewUrl: URL.createObjectURL(file),
    fileName: file.name,
  };
}

function normalizeExtension(fileName: string): string | null {
  const raw = fileName.split('.').pop()?.toLowerCase() ?? '';
  // `jpeg` and `jpg` are the same format; the pack stores one spelling.
  if (raw === 'jpeg') return 'jpg';
  return ['png', 'gif', 'webp', 'jpg'].includes(raw) ? raw : null;
}

/**
 * Encodes bytes as base64.
 *
 * Chunked because `String.fromCharCode` is applied to the whole array at once,
 * and a multi-megabyte spread would overflow the call stack.
 */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/**
 * Turns a display name into a directory name that is not already taken.
 *
 * The name is the user's; the directory has to survive being a path segment, so
 * it is reduced to letters, numbers and hyphens and then made unique.
 */
function uniqueDirectoryName(displayName: string, existingIds: readonly string[]): string {
  const base =
    displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'avatar';

  const taken = new Set(
    existingIds
      .filter((id) => AvatarRegistry.isUserAvatar(id))
      .map((id) => AvatarRegistry.directoryName(id)),
  );

  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * The photo route: generate a prompt, take it to an image model, bring the
 * sheet back.
 *
 * The app does not call any model itself — there is no backend and no network
 * access — so the user is the transport. That makes the prompt the product
 * here: it has to be precise enough that what comes back can be cut up blind.
 */
function AnimatedImportForm({
  registry,
  existingIds,
  onCancel,
  onSaved,
}: {
  readonly registry: AvatarRegistry;
  readonly existingIds: readonly string[];
  readonly onCancel: () => void;
  readonly onSaved: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [extras, setExtras] = useState('');
  const [copied, setCopied] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [removeBackground, setRemoveBackground] = useState(true);
  const [sliced, setSliced] = useState<SliceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const prompt = buildAvatarPrompt({ name, extras });

  // Each slice allocates an object URL per cell; release them when they are
  // replaced or the form closes.
  useEffect(
    () => () => {
      for (const cell of sliced?.cells ?? []) URL.revokeObjectURL(cell.previewUrl);
    },
    [sliced],
  );

  const copyPrompt = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; showing the text is the way out.
      setShowPrompt(true);
      setError('Could not reach the clipboard — the prompt is shown below to copy by hand.');
    }
  }, [prompt]);

  const chooseSheet = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setBusy(true);
      setError(null);
      try {
        const result = await sliceSheet(file, {
          columns: SHEET_COLUMNS,
          rows: SHEET_ROWS,
          removeBackground,
        });
        for (const cell of sliced?.cells ?? []) URL.revokeObjectURL(cell.previewUrl);
        setSliced(result);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [removeBackground, sliced],
  );

  const save = useCallback(async () => {
    const displayName = name.trim();
    if (!displayName) {
      setError('Give your avatar a name.');
      return;
    }
    if (!sliced) {
      setError('Choose the picture the model gave you back.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const id = await registry.saveSheetAvatar({
        directoryName: uniqueDirectoryName(displayName, existingIds),
        displayName,
        cells: sliced.cells,
        cellWidth: sliced.cellWidth,
        cellHeight: sliced.cellHeight,
        contentBounds: sliced.contentBounds,
        baselineY: sliced.baselineY,
      });
      await onSaved(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [existingIds, name, onSaved, registry, sliced]);

  const usableCells = sliced?.cells.filter((cell) => !cell.isEmpty).length ?? 0;

  return (
    <div className="import">
      <h3 className="import__title">Make an avatar from a photo</h3>
      <p className="import__hint">
        This app never sends anything anywhere, so you take the prompt to ChatGPT or Claude
        yourself and bring the picture back. What comes back is a sheet of {SHEET_COLUMNS * SHEET_ROWS}{' '}
        poses — including a full walk cycle, so the legs and arms actually move.
      </p>

      <label className="import__name">
        <span>Name</span>
        <input
          type="text"
          value={name}
          maxLength={40}
          placeholder="Ma"
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </label>

      <label className="import__name">
        <span>Anything to add</span>
        <input
          type="text"
          value={extras}
          maxLength={200}
          placeholder="wearing a white saree, round glasses"
          onChange={(event) => setExtras(event.currentTarget.value)}
        />
      </label>

      <ol className="import__steps">
        {PROMPT_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      <div className="import__actions">
        <Button onClick={() => void copyPrompt()}>{copied ? 'Copied' : 'Copy the prompt'}</Button>
        <Button onClick={() => setShowPrompt((current) => !current)}>
          {showPrompt ? 'Hide prompt' : 'Show prompt'}
        </Button>
      </div>

      {showPrompt ? <textarea className="import__prompt" readOnly value={prompt} rows={14} /> : null}

      <div className="import__sheet">
        <label className="import__toggleRow">
          <input
            type="checkbox"
            checked={removeBackground}
            onChange={(event) => setRemoveBackground(event.currentTarget.checked)}
          />
          <span>
            Remove a flat background
            <em className="import__slotHint">
              {' '}
              — for when the model could not make it transparent
            </em>
          </span>
        </label>

        <label className="import__choose">
          {sliced ? 'Choose a different picture' : 'Choose the picture'}
          <input
            type="file"
            accept={ACCEPTED}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0] ?? null;
              event.currentTarget.value = '';
              void chooseSheet(file);
            }}
          />
        </label>
      </div>

      {busy ? <p className="import__hint">Working…</p> : null}

      {sliced ? (
        <>
          <p className="import__hint">
            {usableCells} of {sliced.cells.length} poses found, {sliced.cellWidth}×
            {sliced.cellHeight} each
            {sliced.removedBackground ? ', background removed' : ''}. Check the walk row lines up
            before saving.
          </p>
          <ul className="import__cells">
            {sliced.cells.map((cell, index) => (
              <li key={cell.index} className="import__cell" data-empty={cell.isEmpty}>
                <img src={cell.previewUrl} alt="" />
                <span>{CELL_LABELS[index] ?? ''}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {error ? <p className="import__error">{error}</p> : null}

      <div className="import__actions">
        <Button onClick={() => void save()}>{busy ? 'Saving…' : 'Save avatar'}</Button>
        <Button tone="danger" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Pose names under each sliced cell, in grid order. */
const CELL_LABELS: readonly string[] = sheetCellPlan().map((cell) => cell.slot);
