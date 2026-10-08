import type Database from '@tauri-apps/plugin-sql';
import { mergeSettings } from '@/settings/merge';
import type { SavedPosition, Settings } from '@/settings/types';
import { createLogger } from '@/utils/logger';
import { openDatabase } from './Database';

const log = createLogger('DB');

const SETTINGS_KEY = 'settings';
const POSITION_KEY = 'lastPosition';

/**
 * Reads and writes settings.
 *
 * SQL lives here and nowhere else: the rest of the application works with
 * typed objects, so the storage format can change without touching it.
 */
export class SettingsRepository {
  private constructor(private readonly database: Database) {}

  static async open(): Promise<SettingsRepository> {
    return new SettingsRepository(await openDatabase());
  }

  /**
   * Loads settings, falling back to defaults.
   *
   * A missing or corrupt row must not stop the companion starting — it would
   * leave the user with no way to fix it, since the fix lives in the settings
   * window.
   */
  async loadSettings(): Promise<Settings> {
    const raw = await this.readValue(SETTINGS_KEY);
    if (raw === null) {
      log.info('No saved settings; using defaults');
      return mergeSettings(null);
    }
    try {
      return mergeSettings(JSON.parse(raw));
    } catch (error) {
      log.error('Saved settings were not valid JSON; using defaults', error);
      return mergeSettings(null);
    }
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.writeValue(SETTINGS_KEY, JSON.stringify(settings));
  }

  async loadPosition(): Promise<SavedPosition | null> {
    const raw = await this.readValue(POSITION_KEY);
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as SavedPosition).displayId === 'string' &&
        Number.isFinite((parsed as SavedPosition).x) &&
        Number.isFinite((parsed as SavedPosition).y)
      ) {
        return parsed as SavedPosition;
      }
      log.warn('Saved position was malformed; ignoring it');
      return null;
    } catch {
      return null;
    }
  }

  async savePosition(position: SavedPosition): Promise<void> {
    await this.writeValue(POSITION_KEY, JSON.stringify(position));
  }

  async clearAll(): Promise<void> {
    await this.database.execute('DELETE FROM settings');
    log.info('All settings cleared');
  }

  private async readValue(key: string): Promise<string | null> {
    const rows = await this.database.select<{ value: string }[]>(
      'SELECT value FROM settings WHERE key = $1',
      [key],
    );
    return rows[0]?.value ?? null;
  }

  private async writeValue(key: string, value: string): Promise<void> {
    // Upsert so a write never has to check whether the row exists first.
    await this.database.execute(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }
}
