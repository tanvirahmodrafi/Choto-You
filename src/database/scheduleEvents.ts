import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { createLogger } from '@/utils/logger';

const log = createLogger('DB');

/**
 * Told when the stored reminders or alarms change.
 *
 * Settings and the overlay are separate webviews with separate copies of
 * everything, and the one that edits a schedule is not the one that acts on it.
 * Before this, an edited reminder only took effect on the next launch; an alarm
 * set that way would simply never go off, which would make the feature look
 * broken rather than stale.
 *
 * The payload is deliberately empty. It says *that* the schedules changed, and
 * the overlay reads them back from the database — the same "write, then
 * broadcast, then each window applies what it reads" path settings already use,
 * rather than a second copy of the data travelling through an event.
 */
export const SCHEDULE_CHANGED = 'schedule-changed';

/** Announces that reminders or alarms were written. Never throws. */
export async function broadcastScheduleChange(): Promise<void> {
  try {
    await emit(SCHEDULE_CHANGED);
  } catch (error) {
    // A failed broadcast costs the overlay a reload, not the edit itself: the
    // write has already happened and will be picked up on the next launch.
    log.warn('Could not announce the schedule change', error);
  }
}

export async function listenForScheduleChanges(onChange: () => void): Promise<UnlistenFn | null> {
  try {
    return await listen(SCHEDULE_CHANGED, () => onChange());
  } catch (error) {
    log.error('Could not listen for schedule changes', error);
    return null;
  }
}
