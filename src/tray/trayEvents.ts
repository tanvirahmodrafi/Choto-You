import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { createLogger } from '@/utils/logger';

const log = createLogger('APP');

/** Must match `TRAY_EVENT` in the Rust tray module. */
const TRAY_EVENT = 'companion://tray';

/**
 * Actions the tray asks the frontend to carry out.
 *
 * Window show/hide is done natively; these are the parts whose state the
 * frontend owns, so that state lives in exactly one place.
 */
export type TrayAction = 'toggle-reminders' | 'shown' | 'hidden';

const ACTIONS: readonly TrayAction[] = ['toggle-reminders', 'shown', 'hidden'];

export async function listenForTrayActions(
  handler: (action: TrayAction) => void,
): Promise<UnlistenFn> {
  return listen<unknown>(TRAY_EVENT, (event) => {
    const action = event.payload;
    if (typeof action !== 'string' || !ACTIONS.includes(action as TrayAction)) {
      log.warn('Unknown tray action received', action);
      return;
    }
    handler(action as TrayAction);
  });
}
