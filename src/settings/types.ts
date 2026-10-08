/**
 * Everything the user can configure.
 *
 * Stored as JSON values in the `settings` key/value table. The shape changes
 * often, so each field is read back defensively: an unknown or corrupt value
 * falls back to its default rather than breaking startup.
 */

export type DisplayMode = 'follow-me' | 'roam' | 'primary' | 'specific';
export type BehaviorIntensity = 'low' | 'normal' | 'active';

/**
 * How much the avatar moves about on its own.
 *
 * `reminders-only` stays hidden between reminders, peeks from a display edge,
 * delivers the message at the centre, then runs offscreen again.
 */
export type RoamMode = 'always' | 'reminders-only' | 'never';

export interface GeneralSettings {
  readonly startWithComputer: boolean;
  readonly launchMinimized: boolean;
  readonly soundEnabled: boolean;
  readonly companionVisible: boolean;
}

export interface CharacterSettings {
  readonly characterId: string;
  /** Multiplies the pack's own default scale. */
  readonly scale: number;
  /** Multiplies the pack's walk speed. */
  readonly speedMultiplier: number;
  readonly animationSpeed: number;
  readonly autonomousBehavior: boolean;
  /**
   * Bumped whenever an avatar's files are rewritten.
   *
   * Selecting a different avatar changes `characterId` and the overlay reloads.
   * Re-importing the one already showing changes nothing the overlay can see —
   * same id, same file paths — so it would keep rendering the frames the user
   * just replaced. This is the signal that the artwork itself moved on.
   */
  readonly avatarRevision: number;
}

export interface DisplaySettings {
  readonly mode: DisplayMode;
  /** Used when mode is 'specific'; a display id from the DisplayManager. */
  readonly specificDisplayId: string | null;
  readonly allowMonitorTransitions: boolean;
  readonly remindersOnActiveMonitor: boolean;
  readonly rememberPosition: boolean;
}

export interface BehaviorSettings {
  readonly roamMode: RoamMode;
  readonly sleepWhenIdle: boolean;
  readonly mouseReactions: boolean;
  readonly cursorTracking: boolean;
  readonly intensity: BehaviorIntensity;
}

export interface AdvancedSettings {
  readonly debugMode: boolean;
  /** Caps the animation loop; lower is cheaper on battery. */
  readonly maxFps: number;
}

export interface Settings {
  readonly general: GeneralSettings;
  readonly character: CharacterSettings;
  readonly display: DisplaySettings;
  readonly behavior: BehaviorSettings;
  readonly advanced: AdvancedSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  general: {
    startWithComputer: false,
    launchMinimized: false,
    soundEnabled: true,
    companionVisible: true,
  },
  character: {
    characterId: 'rafi',
    scale: 1,
    speedMultiplier: 1,
    animationSpeed: 1,
    autonomousBehavior: true,
    avatarRevision: 0,
  },
  display: {
    mode: 'primary',
    specificDisplayId: null,
    allowMonitorTransitions: true,
    remindersOnActiveMonitor: true,
    rememberPosition: true,
  },
  behavior: {
    roamMode: 'always',
    sleepWhenIdle: true,
    mouseReactions: true,
    cursorTracking: true,
    intensity: 'normal',
  },
  advanced: {
    debugMode: false,
    maxFps: 60,
  },
};

/** Where the companion was when it last shut down. */
export interface SavedPosition {
  /** The display it was on, so a vanished monitor can be detected. */
  readonly displayId: string;
  /** Logical points, in virtual-desktop coordinates. */
  readonly x: number;
  readonly y: number;
}
