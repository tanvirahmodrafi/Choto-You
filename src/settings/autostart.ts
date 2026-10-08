import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { createLogger } from '@/utils/logger';

const log = createLogger('APP');

/**
 * Keeps the "start with computer" setting and the real OS login item in step.
 *
 * The two can disagree: the user may remove the login item in System Settings,
 * or a reinstall may drop it. The stored setting is therefore treated as the
 * intent and the OS as the truth, and they are reconciled on startup.
 */

export async function isAutostartEnabled(): Promise<boolean> {
  try {
    return await isEnabled();
  } catch (error) {
    log.warn('Could not read the autostart state', error);
    return false;
  }
}

/**
 * Applies the requested state to the OS.
 * @returns what the OS reports afterwards, which may differ if it refused.
 */
export async function setAutostart(wanted: boolean): Promise<boolean> {
  try {
    if (wanted) {
      await enable();
    } else {
      await disable();
    }
    const actual = await isEnabled();
    if (actual !== wanted) {
      log.warn(`Autostart could not be turned ${wanted ? 'on' : 'off'}`);
    } else {
      log.info(`Autostart turned ${wanted ? 'on' : 'off'}`);
    }
    return actual;
  } catch (error) {
    log.error('Could not change the autostart setting', error);
    return isAutostartEnabled();
  }
}
