import { describe, expect, it } from 'vitest';
import type Database from '@tauri-apps/plugin-sql';
import { ReminderRepository } from './ReminderRepository';

/**
 * Rows reach here from SQLite, which may hold values written by an older build
 * or edited by hand. The repository repairs them rather than trusting them, so
 * one bad column costs its own default instead of the companion's schedule.
 */

/** A row as SQLite returns it: booleans are integers, absent values are null. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'water',
    kind: 'water',
    title: 'Water',
    message: 'Have a drink.',
    enabled: 1,
    interval_minutes: 45,
    animation: 'happy',
    follow_up_animation: 'drink',
    avatar_id: null,
    bubble_seconds: 8,
    sound: null,
    last_triggered: null,
    next_trigger: 1_000_000,
    sort_order: 0,
    ...overrides,
  };
}

/** A repository over fixed rows. The constructor is private by design. */
function repositoryOver(rows: readonly Record<string, unknown>[]): ReminderRepository {
  const database = {
    select: async () => rows,
    execute: async () => ({ rowsAffected: 0, lastInsertId: 0 }),
  } as unknown as Database;

  return new (ReminderRepository as unknown as new (db: Database) => ReminderRepository)(database);
}

describe('ReminderRepository row repair', () => {
  it('loads an ordinary row unchanged', async () => {
    const [reminder] = await repositoryOver([row()]).loadOrSeed(0);

    expect(reminder).toMatchObject({
      id: 'water',
      kind: 'water',
      enabled: true,
      intervalMinutes: 45,
      followUpAnimation: 'drink',
      bubbleSeconds: 8,
      nextTrigger: 1_000_000,
    });
  });

  it('clamps an interval of zero, which would fire on every check', async () => {
    const [reminder] = await repositoryOver([row({ interval_minutes: 0 })]).loadOrSeed(0);
    expect(reminder?.intervalMinutes).toBe(0.1);

    const [capped] = await repositoryOver([row({ interval_minutes: 10_000 })]).loadOrSeed(0);
    expect(capped?.intervalMinutes).toBe(24 * 60);
  });

  it('falls back to a known kind so the performance has something to play', async () => {
    const [reminder] = await repositoryOver([row({ kind: 'nonsense' })]).loadOrSeed(0);
    expect(reminder?.kind).toBe('custom');
  });

  it('replaces a non-finite trigger rather than treating it as always due', async () => {
    // A NaN compares false against every clock reading, so the scheduler would
    // find the reminder due on each check.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const [reminder] = await repositoryOver([row({ next_trigger: bad })]).loadOrSeed(0);
      expect(reminder?.nextTrigger).toBe(0);
    }
  });

  it('keeps a null last-triggered null and repairs a non-finite one', async () => {
    const [never] = await repositoryOver([row({ last_triggered: null })]).loadOrSeed(0);
    expect(never?.lastTriggered).toBeNull();

    const [broken] = await repositoryOver([row({ last_triggered: Number.NaN })]).loadOrSeed(0);
    expect(broken?.lastTriggered).toBeNull();
  });

  it('clamps a bubble duration to something readable', async () => {
    const [brief] = await repositoryOver([row({ bubble_seconds: 0 })]).loadOrSeed(0);
    expect(brief?.bubbleSeconds).toBe(2);

    const [endless] = await repositoryOver([row({ bubble_seconds: 9999 })]).loadOrSeed(0);
    expect(endless?.bubbleSeconds).toBe(120);
  });

  it('supplies an animation when the stored one is empty', async () => {
    const [reminder] = await repositoryOver([row({ animation: '' })]).loadOrSeed(0);
    expect(reminder?.animation).toBe('happy');
  });

  it('omits an absent follow-up rather than carrying an empty one', async () => {
    const [reminder] = await repositoryOver([row({ follow_up_animation: null })]).loadOrSeed(0);
    expect(reminder && 'followUpAnimation' in reminder).toBe(false);
  });

  it('seeds the built-in set when nothing is stored', async () => {
    const seeded = await repositoryOver([]).loadOrSeed(1_000);

    expect(seeded.length).toBeGreaterThan(0);
    // Every seeded reminder is scheduled forward from the time it was seeded.
    for (const reminder of seeded) {
      expect(reminder.nextTrigger).toBeGreaterThan(1_000);
      expect(reminder.lastTriggered).toBeNull();
    }
  });
});
