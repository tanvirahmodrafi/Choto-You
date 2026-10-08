import Database from '@tauri-apps/plugin-sql';
import { createLogger } from '@/utils/logger';

const log = createLogger('DB');

/** Matches the URL the Rust side registered its migrations against. */
const DB_URL = 'sqlite:companion.db';

let connection: Database | null = null;
let opening: Promise<Database> | null = null;

/**
 * Opens the local database, once.
 *
 * Concurrent callers share one connection rather than racing to open several,
 * which SQLite tolerates badly.
 */
export async function openDatabase(): Promise<Database> {
  if (connection) return connection;
  if (opening) return opening;

  opening = Database.load(DB_URL)
    .then((database) => {
      connection = database;
      log.info('Local database ready');
      return database;
    })
    .finally(() => {
      opening = null;
    });

  return opening;
}

export async function closeDatabase(): Promise<void> {
  if (!connection) return;
  const database = connection;
  connection = null;
  try {
    await database.close();
  } catch (error) {
    log.warn('Failed to close the database cleanly', error);
  }
}
