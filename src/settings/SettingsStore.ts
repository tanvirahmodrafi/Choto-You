import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { SettingsRepository } from '@/database/SettingsRepository';
import { createLogger } from '@/utils/logger';
import { mergeSettings } from './merge';
import { DEFAULT_SETTINGS, type Settings } from './types';

const log = createLogger('DB');

/** Broadcast when any window changes settings. */
const SETTINGS_CHANGED = 'companion://settings-changed';

export type SettingsListener = (settings: Settings) => void;

/**
 * The single source of truth for settings, shared by both windows.
 *
 * The companion overlay and the settings window are separate webviews with
 * separate memory, so a change in one has to reach the other. Writes go to the
 * database and then broadcast a Tauri event; every window applies what it
 * receives. That keeps the two in step without either polling the database.
 */
export class SettingsStore {
  private settings: Settings = DEFAULT_SETTINGS;
  private readonly listeners = new Set<SettingsListener>();
  private unlisten: UnlistenFn | null = null;
  private saving: Promise<void> = Promise.resolve();

  private constructor(private readonly repository: SettingsRepository) {}

  static async open(): Promise<SettingsStore> {
    const repository = await SettingsRepository.open();
    const store = new SettingsStore(repository);
    store.settings = await repository.loadSettings();
    await store.subscribeToOtherWindows();
    return store;
  }

  get current(): Settings {
    return this.settings;
  }

  subscribe = (listener: SettingsListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * Applies a change, persists it and tells the other window.
   *
   * Sections are merged one level deep so a caller can update a single field
   * without having to reconstruct the rest of its section.
   */
  async update(patch: DeepPartial<Settings>): Promise<void> {
    const next = mergeSettings({
      general: { ...this.settings.general, ...patch.general },
      character: { ...this.settings.character, ...patch.character },
      display: { ...this.settings.display, ...patch.display },
      behavior: { ...this.settings.behavior, ...patch.behavior },
      advanced: { ...this.settings.advanced, ...patch.advanced },
    });

    this.applyLocally(next);

    // Serialise writes: two quick changes must not race and leave the older
    // one last in the file.
    this.saving = this.saving
      .then(() => this.repository.saveSettings(next))
      .then(() => emit(SETTINGS_CHANGED, next))
      .then(() => undefined)
      .catch((error: unknown) => {
        log.error('Failed to save settings', error);
      });
    await this.saving;
  }

  async resetToDefaults(): Promise<void> {
    await this.repository.clearAll();
    this.applyLocally(DEFAULT_SETTINGS);
    await emit(SETTINGS_CHANGED, DEFAULT_SETTINGS);
  }

  async dispose(): Promise<void> {
    this.unlisten?.();
    this.unlisten = null;
    this.listeners.clear();
    await this.saving;
  }

  private applyLocally(settings: Settings): void {
    this.settings = settings;
    for (const listener of [...this.listeners]) listener(settings);
  }

  private async subscribeToOtherWindows(): Promise<void> {
    this.unlisten = await listen<unknown>(SETTINGS_CHANGED, (event) => {
      // The payload crossed a process boundary, so it is validated exactly
      // like a value read from disk rather than trusted.
      this.applyLocally(mergeSettings(event.payload));
    });
  }
}

/** One level of optionality per section, which is all the UI needs. */
export type DeepPartial<T> = {
  readonly [K in keyof T]?: Partial<T[K]>;
};
