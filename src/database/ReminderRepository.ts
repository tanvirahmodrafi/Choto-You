import type Database from '@tauri-apps/plugin-sql';
import { BUILT_IN_REMINDERS, scheduleNew, type Reminder, type ReminderKind } from '@/reminders/types';
import { createLogger } from '@/utils/logger';
import { openDatabase } from './Database';

const log = createLogger('DB');

/** A row exactly as SQLite returns it; booleans are integers, nulls are nulls. */
interface ReminderRow {
  id: string;
  kind: string;
  title: string;
  message: string;
  enabled: number;
  interval_minutes: number;
  animation: string;
  follow_up_animation: string | null;
  avatar_id: string | null;
  bubble_seconds: number;
  sound: string | null;
  last_triggered: number | null;
  next_trigger: number;
}

const KINDS: readonly ReminderKind[] = ['water', 'stand', 'stretch', 'eyes', 'focus', 'custom'];

export class ReminderRepository {
  private constructor(private readonly database: Database) {}

  static async open(): Promise<ReminderRepository> {
    return new ReminderRepository(await openDatabase());
  }

  /**
   * Loads saved reminders, seeding the built-in set on first run.
   *
   * Seeding here rather than in a migration keeps the defaults in one place
   * in TypeScript, where the rest of the reminder code can see them.
   */
  async loadOrSeed(now: number): Promise<Reminder[]> {
    const rows = await this.database.select<ReminderRow[]>(
      'SELECT * FROM reminders ORDER BY sort_order, id',
    );

    if (rows.length === 0) {
      log.info('No saved reminders; seeding the built-in set');
      const seeded = BUILT_IN_REMINDERS.map((definition) => scheduleNew(definition, now));
      await this.saveAll(seeded);
      return seeded;
    }

    return rows.map(toReminder);
  }

  async saveAll(reminders: readonly Reminder[]): Promise<void> {
    for (const [index, reminder] of reminders.entries()) {
      await this.save(reminder, index);
    }
  }

  async save(reminder: Reminder, sortOrder = 0): Promise<void> {
    await this.database.execute(
      `INSERT INTO reminders (
         id, kind, title, message, enabled, interval_minutes, animation,
         follow_up_animation, avatar_id, bubble_seconds, sound, last_triggered,
         next_trigger, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET
         kind = excluded.kind,
         title = excluded.title,
         message = excluded.message,
         enabled = excluded.enabled,
         interval_minutes = excluded.interval_minutes,
         animation = excluded.animation,
         follow_up_animation = excluded.follow_up_animation,
         avatar_id = excluded.avatar_id,
         bubble_seconds = excluded.bubble_seconds,
         sound = excluded.sound,
         last_triggered = excluded.last_triggered,
         next_trigger = excluded.next_trigger,
         sort_order = excluded.sort_order`,
      [
        reminder.id,
        reminder.kind,
        reminder.title,
        reminder.message,
        reminder.enabled ? 1 : 0,
        reminder.intervalMinutes,
        reminder.animation,
        reminder.followUpAnimation ?? null,
        reminder.avatarId ?? null,
        reminder.bubbleSeconds,
        reminder.sound ?? null,
        reminder.lastTriggered,
        reminder.nextTrigger,
        sortOrder,
      ],
    );
  }

  async remove(id: string): Promise<void> {
    await this.database.execute('DELETE FROM reminders WHERE id = $1', [id]);
  }

  async clearAll(): Promise<void> {
    await this.database.execute('DELETE FROM reminders');
  }
}

/**
 * Converts a row into a reminder, repairing anything implausible.
 *
 * A row can predate the current build or have been edited by hand, so values
 * are clamped rather than trusted — an interval of zero would otherwise fire
 * a reminder on every single check.
 */
function toReminder(row: ReminderRow): Reminder {
  const kind: ReminderKind = KINDS.includes(row.kind as ReminderKind)
    ? (row.kind as ReminderKind)
    : 'custom';

  return {
    id: row.id,
    kind,
    title: row.title,
    message: row.message,
    enabled: row.enabled !== 0,
    intervalMinutes: clamp(row.interval_minutes, 0.1, 24 * 60),
    animation: row.animation || 'happy',
    ...(row.follow_up_animation ? { followUpAnimation: row.follow_up_animation } : {}),
    avatarId: row.avatar_id,
    bubbleSeconds: clamp(row.bubble_seconds, 2, 120),
    ...(row.sound ? { sound: row.sound } : {}),
    lastTriggered: row.last_triggered,
    nextTrigger: row.next_trigger,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
