import type Database from '@tauri-apps/plugin-sql';
import { normaliseMinutes, type Alarm } from '@/alarms/types';
import { openDatabase } from './Database';

/** A row exactly as SQLite returns it; booleans are integers, nulls are nulls. */
interface AlarmRow {
  id: string;
  label: string;
  message: string;
  enabled: number;
  at_minutes: number;
  repeat_daily: number;
  lead_minutes: number;
  avatar_id: string | null;
  next_trigger: number;
  lead_done: number;
  last_triggered: number | null;
}

/**
 * Alarms, as stored.
 *
 * Unlike reminders there is nothing to seed: an alarm only exists because the
 * user set one, and an app that invented alarms of its own would be alarming.
 */
export class AlarmRepository {
  private constructor(private readonly database: Database) {}

  static async open(): Promise<AlarmRepository> {
    return new AlarmRepository(await openDatabase());
  }

  async loadAll(): Promise<Alarm[]> {
    const rows = await this.database.select<AlarmRow[]>(
      'SELECT * FROM alarms ORDER BY sort_order, at_minutes, id',
    );
    return rows.map(toAlarm);
  }

  async saveAll(alarms: readonly Alarm[]): Promise<void> {
    for (const [index, alarm] of alarms.entries()) {
      await this.save(alarm, index);
    }
  }

  async save(alarm: Alarm, sortOrder = 0): Promise<void> {
    await this.database.execute(
      `INSERT INTO alarms (
         id, label, message, enabled, at_minutes, repeat_daily, lead_minutes,
         avatar_id, next_trigger, lead_done, last_triggered, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET
         label = excluded.label,
         message = excluded.message,
         enabled = excluded.enabled,
         at_minutes = excluded.at_minutes,
         repeat_daily = excluded.repeat_daily,
         lead_minutes = excluded.lead_minutes,
         avatar_id = excluded.avatar_id,
         next_trigger = excluded.next_trigger,
         lead_done = excluded.lead_done,
         last_triggered = excluded.last_triggered,
         sort_order = excluded.sort_order`,
      [
        alarm.id,
        alarm.label,
        alarm.message,
        alarm.enabled ? 1 : 0,
        normaliseMinutes(alarm.atMinutes),
        alarm.repeatDaily ? 1 : 0,
        alarm.leadMinutes,
        alarm.avatarId ?? null,
        alarm.nextTrigger,
        alarm.leadDone ? 1 : 0,
        alarm.lastTriggered,
        sortOrder,
      ],
    );
  }

  async remove(id: string): Promise<void> {
    await this.database.execute('DELETE FROM alarms WHERE id = $1', [id]);
  }
}

/**
 * Converts a row into an alarm, repairing anything implausible.
 *
 * A row can predate the current build or have been edited by hand. A time of
 * day outside one day, or a warning longer than the gap it is warning about,
 * would otherwise schedule something that never fires or fires immediately.
 */
function toAlarm(row: AlarmRow): Alarm {
  const atMinutes = normaliseMinutes(row.at_minutes);
  return {
    id: row.id,
    label: row.label || 'Alarm',
    message: row.message ?? '',
    enabled: row.enabled !== 0,
    atMinutes,
    repeatDaily: row.repeat_daily !== 0,
    leadMinutes: clamp(row.lead_minutes, 0, 12 * 60),
    avatarId: row.avatar_id,
    nextTrigger: Number.isFinite(row.next_trigger) ? row.next_trigger : 0,
    leadDone: row.lead_done !== 0,
    lastTriggered: row.last_triggered,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
