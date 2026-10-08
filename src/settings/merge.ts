import { DEFAULT_SETTINGS, type RoamMode, type Settings } from './types';

/**
 * Rebuilds a complete `Settings` from whatever was read back from storage.
 *
 * Stored values are untrusted: a database written by an older build will be
 * missing fields, and a hand-edited or corrupt one may hold the wrong types.
 * Every field is checked individually so one bad value costs its own default
 * rather than the whole settings object.
 */
export function mergeSettings(stored: unknown): Settings {
  const source = isRecord(stored) ? stored : {};
  const d = DEFAULT_SETTINGS;

  const general = section(source, 'general');
  const character = section(source, 'character');
  const display = section(source, 'display');
  const behavior = section(source, 'behavior');
  const advanced = section(source, 'advanced');

  return {
    general: {
      startWithComputer: bool(general['startWithComputer'], d.general.startWithComputer),
      launchMinimized: bool(general['launchMinimized'], d.general.launchMinimized),
      soundEnabled: bool(general['soundEnabled'], d.general.soundEnabled),
      companionVisible: bool(general['companionVisible'], d.general.companionVisible),
    },
    character: {
      characterId: text(character['characterId'], d.character.characterId),
      scale: number(character['scale'], d.character.scale, 0.5, 3),
      speedMultiplier: number(character['speedMultiplier'], d.character.speedMultiplier, 0.25, 4),
      animationSpeed: number(character['animationSpeed'], d.character.animationSpeed, 0.25, 4),
      autonomousBehavior: bool(character['autonomousBehavior'], d.character.autonomousBehavior),
      avatarRevision: number(character['avatarRevision'], d.character.avatarRevision, 0, Number.MAX_SAFE_INTEGER),
    },
    display: {
      mode: oneOf(display['mode'], ['follow-me', 'roam', 'primary', 'specific'] as const, d.display.mode),
      specificDisplayId:
        typeof display['specificDisplayId'] === 'string' ? display['specificDisplayId'] : null,
      allowMonitorTransitions: bool(
        display['allowMonitorTransitions'],
        d.display.allowMonitorTransitions,
      ),
      remindersOnActiveMonitor: bool(
        display['remindersOnActiveMonitor'],
        d.display.remindersOnActiveMonitor,
      ),
      rememberPosition: bool(display['rememberPosition'], d.display.rememberPosition),
    },
    behavior: {
      roamMode: roamMode(behavior, d.behavior.roamMode),
      sleepWhenIdle: bool(behavior['sleepWhenIdle'], d.behavior.sleepWhenIdle),
      mouseReactions: bool(behavior['mouseReactions'], d.behavior.mouseReactions),
      cursorTracking: bool(behavior['cursorTracking'], d.behavior.cursorTracking),
      intensity: oneOf(behavior['intensity'], ['low', 'normal', 'active'] as const, d.behavior.intensity),
    },
    advanced: {
      debugMode: bool(advanced['debugMode'], d.advanced.debugMode),
      maxFps: number(advanced['maxFps'], d.advanced.maxFps, 15, 144),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function section(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  return isRecord(value) ? value : {};
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/** Numbers are clamped as well as type-checked, so a bad value cannot make the companion unusable. */
function number(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Reads the roam mode, honouring the boolean this setting replaced.
 *
 * Builds before the parked mode existed stored `walkAround: true | false`. A
 * user who had turned wandering off should stay off after an update rather than
 * finding their avatar pacing around again.
 */
function roamMode(behavior: Record<string, unknown>, fallback: RoamMode): RoamMode {
  const stored = behavior['roamMode'];
  if (typeof stored === 'string') {
    return oneOf(stored, ['always', 'reminders-only', 'never'] as const, fallback);
  }
  const legacy = behavior['walkAround'];
  if (typeof legacy === 'boolean') return legacy ? 'always' : 'never';
  return fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}
