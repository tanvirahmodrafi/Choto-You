import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { AnimationPlayer } from '@/animation/AnimationPlayer';
import { loadAnimations } from '@/animation/AnimationLoader';
import { ticker } from '@/animation/Ticker';
import { IdleMonitor } from '@/behavior/IdleMonitor';
import { SoundPlayer } from '@/services/SoundPlayer';
import { WanderBehavior } from '@/behavior/WanderBehavior';
import { loadCharacter } from '@/characters/CharacterLoader';
import { AvatarRegistry, DEFAULT_AVATAR_ID } from '@/characters/AvatarRegistry';
import { DisplayManager } from '@/displays/DisplayManager';
import { ActiveMonitorDetector } from '@/displays/ActiveMonitorDetector';
import { DisplayWatcher } from '@/displays/DisplayWatcher';
import { MonitorTopology } from '@/displays/MonitorTopology';
import type { DisplayInfo } from '@/displays/types';
import { hitboxRect } from '@/interaction/Hitbox';
import { InteractionController } from '@/interaction/InteractionController';
import { BoundaryDetector } from '@/movement/BoundaryDetector';
import { MonitorTransition } from '@/movement/MonitorTransition';
import { DEFAULT_MOVEMENT_CONFIG, MovementEngine } from '@/movement/MovementEngine';
import { AnimationPriority } from '@/animation/types';
import type { Rect, Vector2 } from '@/movement/types';
import type { LoadedCharacter } from '@/types/character';
import { createLogger } from '@/utils/logger';
import { listenForTrayActions, type TrayAction } from '@/tray/trayEvents';
import { PositionStore } from '@/database/PositionStore';
import { AlarmRepository } from '@/database/AlarmRepository';
import { ReminderRepository } from '@/database/ReminderRepository';
import { listenForScheduleChanges } from '@/database/scheduleEvents';
import { SettingsRepository } from '@/database/SettingsRepository';
import { SettingsStore } from '@/settings/SettingsStore';
import { DEFAULT_INTERACTION_CONFIG as BASE_INTERACTION } from '@/interaction/types';
import type { DisplayMode, RoamMode, Settings } from '@/settings/types';
import { ReminderCoordinator } from '@/reminders/ReminderCoordinator';
import type { Announcement } from '@/reminders/types';
import { ReminderVisit } from '@/reminders/ReminderVisit';
import { AvatarHandover, type HandoverStage } from '@/reminders/AvatarHandover';
import {
  characterOnlyLayout,
  characterRectFor,
  computeLayout,
  windowOriginFor,
  type OverlayLayout,
} from './OverlayLayout';
import { WindowPositioner } from './WindowPositioner';

const log = createLogger('APP');
const moveLog = createLogger('MOVE');
const displayLog = createLogger('DISPLAY');

/** How often the companion's position is logged while it is moving, in seconds. */
const POSITION_LOG_INTERVAL = 1;

/**
 * How often the companion even considers moving to another display, in seconds,
 * and the chance it takes the opportunity.
 *
 * Both the interval and the roll are time-based rather than per-frame, so the
 * companion behaves identically on a 60Hz and a 120Hz display. Rolling once
 * per frame would make roaming frame-rate dependent and far too frequent.
 */
const ROAM_CHECK_INTERVAL = 25;
const ROAM_CHANCE = 0.35;

/** How long the cursor must be still before the companion dozes off. */
const SLEEP_AFTER_SECONDS = 10 * 60;

/**
 * Wires the companion's subsystems together and drives them from one tick.
 *
 * Construction is split from `create` because loading a character is async and
 * can fail; a runtime only exists once everything it needs is in hand.
 */
export class CompanionRuntime {
  private unsubscribe: (() => void) | null = null;
  private sinceLastPositionLog = 0;
  private sinceLastRoamCheck = 0;
  private wasFalling = false;
  private layout: OverlayLayout;
  /** Settings mirrored as plain fields, so the hot loop never walks an object graph. */
  private autonomous = true;
  private roamMode: RoamMode = 'always';
  private allowTransitions = true;
  private debug = false;
  private scaleMultiplier = 1;
  private speedMultiplier = 1;
  private readonly settingsListeners = new Set<() => void>();
  private settingsStore: SettingsStore | null = null;
  private settingsReady = false;
  private positionStore: PositionStore | null = null;
  private unsubscribeSettings: (() => void) | null = null;
  private unlistenTray: (() => void) | null = null;
  private unlistenSchedules: (() => void) | null = null;
  /** Held so an edit made in settings can be read back. */
  private reminderRepository: ReminderRepository | null = null;
  private alarmRepository: AlarmRepository | null = null;
  private readonly idleMonitor = new IdleMonitor(SLEEP_AFTER_SECONDS);
  private sleeping = false;
  private sleepEnabled = true;
  /** Entrance and escape choreography for reminder-only appearances. */
  readonly reminderVisit = new ReminderVisit();
  /** The exchange of avatars around a reminder while free-roaming. */
  private readonly handover = new AvatarHandover();
  /** The avatar a handover is fetching, kept until the visit is over. */
  private visitorAvatarId: string | null = null;
  /** The avatar the user chose, as opposed to one a reminder is borrowing. */
  private chosenAvatarId = DEFAULT_AVATAR_ID;
  /** The avatar revision the loaded artwork belongs to. */
  private loadedAvatarRevision = 0;
  /** True once settings have been applied, so the first read is not a "change". */
  private appliedSettingsOnce = false;
  /** Guards against two avatar loads racing; the last request wins. */
  private avatarLoadToken = 0;
  private readonly avatars = new AvatarRegistry();
  /** The id of the pack currently rendered, including any a reminder borrowed. */
  private loadedAvatarId = DEFAULT_AVATAR_ID;
  private readonly sound = new SoundPlayer();
  private readonly reminders: ReminderCoordinator;
  private readonly activeMonitor: ActiveMonitorDetector;
  private displayMode: DisplayMode = 'primary';
  private pinnedDisplayId: string | null = null;
  private topology: MonitorTopology;
  private transition: MonitorTransition;
  private readonly watcher: DisplayWatcher;
  readonly interaction: InteractionController;

  /** The pack currently being rendered. Changes when the avatar is swapped. */
  private loadedCharacter: LoadedCharacter;

  get character(): LoadedCharacter {
    return this.loadedCharacter;
  }

  private constructor(
    character: LoadedCharacter,
    readonly player: AnimationPlayer,
    readonly movement: MovementEngine,
    readonly displays: DisplayManager,
    private readonly boundaries: BoundaryDetector,
    private readonly behavior: WanderBehavior,
    private readonly positioner: WindowPositioner,
    private currentDisplay: DisplayInfo,
  ) {
    this.loadedCharacter = character;
    this.layout = characterOnlyLayout(boundaries.companionSize);
    this.topology = new MonitorTopology(displays.all);
    this.transition = new MonitorTransition(movement, boundaries, player, this.topology);
    this.watcher = new DisplayWatcher(displays, () => this.handleDisplayChange());
    this.activeMonitor = new ActiveMonitorDetector(displays);
    this.reminders = new ReminderCoordinator(
      {
        player,
        isBusy: () => this.isBusyForReminder(),
        prepareForReminder: (announcement) => this.prepareForReminder(announcement),
        isReadyForReminder: () => this.isReadyForReminder(),
        finishReminder: () => this.finishReminder(),
      },
      this.sound,
    );
    this.interaction = new InteractionController(
      {
        getHitbox: () => this.hitbox(),
        toLogical: (point) => displays.physicalToLogical(point),
        setClickThrough: (ignore) => void this.setClickThrough(ignore),
        events: {
          onClick: () => this.react('happy'),
          onDoubleClick: () => this.react('surprised'),
          onRightClick: () => void this.openSettings(),
          onDragStart: () => this.beginDrag(),
          onDrag: (position) => this.movement.setPosition(position, 'held'),
          onDragEnd: () => this.endDrag(),
          onProximityChange: (near, cursor) => this.lookAt(near, cursor),
          onCursorMoved: (cursor) => this.idleMonitor.observeCursor(cursor),
        },
      },
      BASE_INTERACTION,
    );
  }

  /**
   * The character's clickable rectangle in virtual-desktop coordinates.
   *
   * Derived from where the character actually ended up, not from where
   * movement asked it to be: while a speech bubble is up the window is larger
   * and may have been clamped to stay on screen, taking the character with it.
   */
  private hitbox(): Rect {
    if (!this.settingsReady || this.roamMode === 'reminders-only') return { x: 0, y: 0, width: 0, height: 0 };
    const size = this.boundaries.companionSize;
    const position = this.movement.getSnapshot().position;
    const origin = windowOriginFor(this.layout, position, this.boundaries.currentBounds);
    const rect = characterRectFor(this.layout, origin, size);
    return hitboxRect(rect, size, this.loadedCharacter.manifest.hitbox);
  }

  private async setClickThrough(ignore: boolean): Promise<void> {
    try {
      await getCurrentWindow().setIgnoreCursorEvents(ignore);
    } catch (error) {
      log.error('Failed to toggle click-through', error);
    }
  }

  /** Plays a one-shot reaction, then returns to idle. */
  private react(animation: string): void {
    if (this.roamMode === 'reminders-only') return;
    this.idleMonitor.markActive();
    this.wakeUp();
    if (this.transition.isActive) return;
    this.behavior.interrupt();
    this.player.play(animation, {
      priority: AnimationPriority.REACTION,
      restart: true,
      onFinish: () => this.player.play('idle', { priority: AnimationPriority.AMBIENT, force: true }),
    });
  }

  private beginDrag(): void {
    // Picking the companion up outranks a reminder, including one mid-handover:
    // the user is holding the character, so it cannot also be walking off.
    if (this.handover.isActive) {
      this.reminders.cancelCurrent();
      this.abortHandover();
    }
    this.idleMonitor.markActive();
    this.wakeUp();
    this.transition.cancel();
    this.behavior.interrupt();
    this.movement.hold();
    this.player.play('dragged', { priority: AnimationPriority.REACTION, force: true });
  }

  /**
   * Released from a drag: fall from wherever the user let go, then land.
   *
   * The companion may have been dropped over a different display, so the
   * work area is re-resolved before gravity is applied — otherwise it would
   * fall towards the floor of the display it started on.
   */
  private endDrag(): void {
    const { position } = this.movement.getSnapshot();
    const display =
      this.displays.displayContaining(position) ?? this.displays.nearestDisplay(position);
    if (display && display.id !== this.currentDisplay.id) {
      this.enterDisplay(display);
    }

    this.movement.release();
    const falling = !this.movement.getSnapshot().grounded;
    this.player.play(falling ? 'fall' : 'land', {
      priority: AnimationPriority.REACTION,
      force: true,
      ...(falling ? {} : { onFinish: () => this.player.play('idle', { priority: AnimationPriority.AMBIENT, force: true }) }),
    });
    this.wasFalling = falling;
  }

  /** Faces the cursor when it comes close, without otherwise reacting. */
  private lookAt(near: boolean, cursor: Vector2 | null): void {
    if (this.roamMode === 'reminders-only') return;
    if (!near || !cursor) return;
    if (this.movement.getSnapshot().mode !== 'idle') return;
    this.movement.faceToward(cursor.x);
  }

  static async create(requestedAvatarId?: string): Promise<CompanionRuntime> {
    // Resolve the chosen avatar before anything is drawn. Loading the default
    // first and swapping once settings arrive would show the wrong character
    // for a moment on every launch.
    const registry = new AvatarRegistry();
    const wanted = requestedAvatarId ?? DEFAULT_AVATAR_ID;
    const { character, avatarId: loadedId } = await loadWithFallback(registry, wanted);
    const { clips } = await loadAnimations(character);

    const displays = new DisplayManager();
    await waitForDisplays(displays);

    const window = getCurrentWindow();
    const [outerSize, outerPosition, scaleFactor] = await Promise.all([
      window.outerSize(),
      window.outerPosition(),
      window.scaleFactor(),
    ]);

    // Everything below works in logical points, so convert the window geometry
    // once here rather than scattering divisions through the movement layer.
    const size = {
      width: Math.round(outerSize.width / scaleFactor),
      height: Math.round(outerSize.height / scaleFactor),
    };
    const start = displays.physicalToLogical({ x: outerPosition.x, y: outerPosition.y });

    // Start on whichever display the window was placed on, falling back to the
    // nearest one so an off-screen start position still resolves to something.
    const display =
      displays.displayContaining(start) ?? displays.nearestDisplay(start) ?? displays.primary;
    if (!display) throw new Error('No usable display was reported by the operating system');

    log.info(`Starting on "${display.name}"`, display.workArea);

    const boundaries = new BoundaryDetector(display.workArea, size);
    const movement = new MovementEngine(boundaries, { x: start.x, y: boundaries.groundY }, {
      ...DEFAULT_MOVEMENT_CONFIG,
      walkSpeed: character.manifest.movement.walkSpeed,
    });

    const player = new AnimationPlayer(clips);
    player.play('idle');

    const positioner = new WindowPositioner((point) => displays.logicalToPhysical(point));
    positioner.prime({ origin: start, size });

    const behavior = new WanderBehavior(movement, boundaries, player);

    const runtime = new CompanionRuntime(
      character,
      player,
      movement,
      displays,
      boundaries,
      behavior,
      positioner,
      display,
    );
    // The id the loader actually used, not one inferred from the manifest. A
    // user pack is addressed as `user:<dir>` but its manifest names the bare
    // directory, so comparing the two marked every imported avatar as "not the
    // one we wanted": the first settings read then saw an avatar change and
    // swapped the pack for the one already on screen, decoding every frame a
    // second time on each launch.
    runtime.chosenAvatarId = loadedId;
    runtime.loadedAvatarId = loadedId;
    runtime.start();
    return runtime;
  }

  // --- avatars ------------------------------------------------------------

  /**
   * Swaps the rendered pack.
   *
   * The character keeps its place on screen and, where both packs have the
   * pose, its current animation frame: a swap mid-stride does not restart the
   * walk. Only the artwork, the hitbox and the size change.
   *
   * Loads are token-guarded. A user clicking through the avatar picker can
   * easily start a second load before the first finishes, and without the token
   * the slower one would win and contradict what they last clicked.
   */
  private async swapAvatar(
    avatarId: string,
    options: { readonly force?: boolean } = {},
  ): Promise<void> {
    // `force` is set when the artwork behind an unchanged id was replaced, which
    // is the one case where reloading the avatar already on screen is correct.
    if (!options.force && avatarId === this.loadedAvatarId) return;
    this.loadedAvatarId = avatarId;

    const token = ++this.avatarLoadToken;
    let character: LoadedCharacter;
    let loadedId: string;
    try {
      ({ character, avatarId: loadedId } = await loadWithFallback(this.avatars, avatarId));
    } catch (error) {
      log.error(`Could not load avatar "${avatarId}"; keeping the current one`, error);
      return;
    }

    const { clips } = await loadAnimations(character);
    if (token !== this.avatarLoadToken) {
      log.debug(`Discarding avatar "${avatarId}"; a newer request superseded it`);
      return;
    }

    // If the requested pack was gone and the default was loaded instead, record
    // the pack actually on screen. Claiming the requested one would leave the
    // reminder handover comparing against an avatar that is not being rendered.
    this.loadedAvatarId = loadedId;
    this.loadedCharacter = character;
    this.player.setClips(clips);

    // A pack may be drawn at a different size, which changes both the window
    // and the floor the character stands on.
    this.applySize();
    this.movement.setConfig({
      ...DEFAULT_MOVEMENT_CONFIG,
      walkSpeed: character.manifest.movement.walkSpeed * this.speedMultiplier,
    });
    this.movement.revalidate();

    log.info(`Avatar is now "${character.manifest.name}"`);
    for (const listener of [...this.settingsListeners]) listener();
  }

  private start(): void {
    this.unsubscribe = ticker.subscribe((delta) => this.update(delta));
    this.watcher.start();
    this.interaction.start();
    void this.loadPersistentState();
    void this.listenToTray();
  }

  private update(delta: number): void {
    if (!this.settingsReady) return;
    if (this.roamMode === 'reminders-only') {
      this.updateReminderVisit(delta);
      this.reminders.update(delta);
      this.player.update(delta);
      this.applyFrame(this.movement.getSnapshot().position);
      return;
    }
    this.reminders.update(delta);

    if (this.handover.isActive) {
      // One avatar is walking out and another in: the choreography owns every
      // step, including the stretch after the reminder itself has finished.
      this.updateHandover(delta);
    } else if (this.reminders.isPerforming) {
      // A reminder owns the companion while it plays: no wandering, no roaming.
    } else if (this.transition.isActive) {
      // While crossing displays the transition owns the companion; ambient
      // wandering must not pull it back mid-jump.
      this.transition.update(delta);
    } else {
      this.updateSleep();
      this.updateFollowMe(delta);
      if (this.autonomous && !this.sleeping) {
        this.behavior.update(delta);
        this.maybeRoam(delta);
      }
    }

    this.movement.update(delta);
    this.player.update(delta);

    const snapshot = this.movement.getSnapshot();
    this.applyFrame(snapshot.position);

    // A fall that began from a drag ends with a landing reaction. The movement
    // engine reports the touchdown; the animation response belongs here.
    if (this.wasFalling && snapshot.grounded && snapshot.mode !== 'held') {
      this.wasFalling = false;
      if (!this.transition.isActive) {
        this.player.play('land', {
          priority: AnimationPriority.REACTION,
          force: true,
          onFinish: () =>
            this.player.play('idle', { priority: AnimationPriority.AMBIENT, force: true }),
        });
      }
    }

    // Throttled: a per-frame position log would be unreadable and would cost
    // more than the movement it is reporting on.
    if (snapshot.mode === 'idle') {
      this.positionStore?.record(this.currentDisplay.id, snapshot.position);
    }

    this.sinceLastPositionLog += delta;
    if (snapshot.mode !== 'idle' && this.sinceLastPositionLog >= POSITION_LOG_INTERVAL) {
      this.sinceLastPositionLog = 0;
      moveLog.debug(
        `${snapshot.mode} ${snapshot.direction} at (${Math.round(snapshot.position.x)}, ${Math.round(snapshot.position.y)})`,
      );
    }
  }

  // --- tray ---------------------------------------------------------------

  private async listenToTray(): Promise<void> {
    try {
      this.unlistenTray = await listenForTrayActions((action) => this.handleTrayAction(action));
    } catch (error) {
      log.error('Could not subscribe to tray actions', error);
    }
  }

  private handleTrayAction(action: TrayAction): void {
    switch (action) {
      case 'toggle-reminders':
        this.reminders.setPaused(!this.reminders.isPaused);
        break;
      case 'hidden':
        // Stop simulating a character nobody can see. This is the explicit
        // signal the ticker waits for — it deliberately ignores the webview's
        // own visibility, which lies when the app is merely inactive.
        ticker.setPaused(true);
        void this.settingsStore?.update({ general: { companionVisible: false } });
        break;
      case 'shown':
        ticker.setPaused(false);
        void this.settingsStore?.update({ general: { companionVisible: true } });
        break;
    }
  }

  // --- persistence --------------------------------------------------------

  /**
   * Brings in everything that survives a restart.
   *
   * The overlay waits for settings before painting, so reminder-only mode
   * cannot briefly flash a visible avatar on startup. Failures use defaults.
   */
  private async loadPersistentState(): Promise<void> {
    try {
      const settingsRepository = await SettingsRepository.open();
      this.positionStore = new PositionStore(settingsRepository);

      this.settingsStore = await SettingsStore.open();
      this.applySettings(this.settingsStore.current);
      this.unsubscribeSettings = this.settingsStore.subscribe((settings) =>
        this.applySettings(settings),
      );

      await this.restorePosition(settingsRepository);

      this.reminderRepository = await ReminderRepository.open();
      this.reminders.adopt(
        this.reminderRepository,
        await this.reminderRepository.loadOrSeed(Date.now()),
      );

      this.alarmRepository = await AlarmRepository.open();
      this.reminders.adoptAlarms(this.alarmRepository, await this.alarmRepository.loadAll());

      this.unlistenSchedules =
        (await listenForScheduleChanges(() => void this.reloadSchedules())) ?? null;
    } catch (error) {
      log.error('Could not load saved state; continuing with defaults', error);
      this.reminders.startWithout();
    } finally {
      this.settingsReady = true;
      for (const listener of [...this.settingsListeners]) listener();
    }
  }

  /**
   * Puts the companion back where it was, if that is still a real place.
   *
   * The display it was on may be gone, or may have changed resolution, so the
   * saved coordinates are validated against the current layout rather than
   * applied blindly.
   */
  private async restorePosition(repository: SettingsRepository): Promise<void> {
    if (!this.settingsStore?.current.display.rememberPosition) return;

    const saved = await repository.loadPosition();
    if (!saved) return;

    const display = this.displays.byId(saved.displayId);
    if (!display) {
      displayLog.info(`Saved display "${saved.displayId}" is gone; staying put`);
      return;
    }

    this.enterDisplay(display);
    const restored = this.boundaries.clampPosition({ x: saved.x, y: saved.y });
    this.movement.setPosition(restored, 'idle');
    log.info(`Restored position on "${display.name}"`, restored);
  }

  /** Applies settings to the live companion, without a restart. */
  private applySettings(settings: Settings): void {
    const manifest = this.loadedCharacter.manifest;

    this.speedMultiplier = settings.character.speedMultiplier;
    this.movement.setConfig({
      ...DEFAULT_MOVEMENT_CONFIG,
      walkSpeed: manifest.movement.walkSpeed * this.speedMultiplier,
    });

    this.interaction.setConfig({
      ...BASE_INTERACTION,
      enabled: settings.behavior.mouseReactions,
      reactToClick: settings.behavior.mouseReactions,
      reactToDoubleClick: settings.behavior.mouseReactions,
      trackCursor: settings.behavior.cursorTracking,
    });

    const previousRoamMode = this.roamMode;
    this.roamMode = settings.behavior.roamMode;
    this.autonomous = settings.character.autonomousBehavior && this.roamMode === 'always';
    if (previousRoamMode !== this.roamMode) {
      this.behavior.interrupt();
      this.transition.cancel();
      this.reminderVisit.reset();
      this.abortHandover();
      this.movement.stop();
      this.movement.setPosition(this.boundaries.safePosition(), 'idle');
      if (this.roamMode === 'reminders-only' && this.reminders.isPerforming) {
        this.reminderVisit.stage = 'present';
      }
    }
    this.sleepEnabled = settings.behavior.sleepWhenIdle;
    this.sound.setEnabled(settings.general.soundEnabled);
    this.player.setSpeed(settings.character.animationSpeed);
    ticker.setMaxFps(settings.advanced.maxFps);
    if (!this.sleepEnabled && this.sleeping) this.wakeUp();
    this.allowTransitions = settings.display.allowMonitorTransitions;
    if (this.displayMode !== settings.display.mode) this.activeMonitor.reset();
    this.displayMode = settings.display.mode;
    this.pinnedDisplayId = settings.display.specificDisplayId;
    this.enforceDisplayMode();
    this.debug = settings.advanced.debugMode;
    this.setScale(settings.character.scale);

    // Last, because it is the one asynchronous step: a swap that is still
    // loading must not hold up everything else the user just changed.
    const avatarChanged = settings.character.characterId !== this.chosenAvatarId;
    // A re-import leaves the id alone but replaces the artwork underneath it.
    const artworkChanged = settings.character.avatarRevision !== this.loadedAvatarRevision;

    // The first settings read is not a change. `create` has already loaded the
    // chosen avatar at whatever revision is current, but the runtime starts
    // counting from revision zero, so any user who had ever re-imported an
    // avatar saw this compare unequal on launch and reload the pack already on
    // screen — decoding every frame a second time before the companion had
    // finished appearing.
    if (!this.appliedSettingsOnce) {
      this.appliedSettingsOnce = true;
      this.loadedAvatarRevision = settings.character.avatarRevision;
      if (!avatarChanged) {
        for (const listener of [...this.settingsListeners]) listener();
        return;
      }
    }

    if (avatarChanged || artworkChanged) {
      this.chosenAvatarId = settings.character.characterId;
      this.loadedAvatarRevision = settings.character.avatarRevision;
      // A reminder currently wearing a borrowed avatar keeps it until it ends,
      // at which point `finishReminder` restores the newly chosen one.
      if (!this.reminders.isPerforming) {
        void this.swapAvatar(this.chosenAvatarId, { force: artworkChanged });
      }
    }

    for (const listener of [...this.settingsListeners]) listener();
  }

  /**
   * Resizes the character.
   *
   * The character box is what the boundary detector clamps against, so a
   * larger character needs the work-area limits recomputed or it would be
   * able to walk partly off the screen.
   */
  private setScale(scale: number): void {
    if (scale === this.scaleMultiplier) return;
    this.scaleMultiplier = scale;
    this.applySize();
  }

  /**
   * Recomputes the character box from the current pack and scale.
   *
   * Shared by the size setting and by an avatar swap, because a different pack
   * may be drawn at a different size and the boundary detector has to be told.
   */
  private applySize(): void {
    const manifest = this.loadedCharacter.manifest;
    const base = manifest.defaultScale * this.scaleMultiplier;
    // The loader already bounds both factors; this keeps their product sane
    // too, so no combination of a pack and a size setting can produce a
    // character box the user cannot find or cannot click.
    this.boundaries.setSize({
      width: characterExtent(manifest.frameSize.width * base),
      height: characterExtent(manifest.frameSize.height * base),
    });
    this.movement.revalidate();
  }

  /**
   * Opens the settings window.
   *
   * Right-clicking the companion is the only way in until the tray exists in
   * Phase 9, so a failure here would leave settings unreachable — hence the
   * explicit error rather than a silent catch.
   */
  async openSettings(): Promise<void> {
    try {
      const settings = await WebviewWindow.getByLabel('settings');
      if (!settings) {
        log.error('Settings window is missing');
        return;
      }
      await settings.show();
      await settings.unminimize();
      await settings.setFocus();
    } catch (error) {
      log.error('Could not open the settings window', error);
    }
  }

  /** Scale to render the character at, including the user's size setting. */
  getRenderScale(): number {
    return this.loadedCharacter.manifest.defaultScale * this.scaleMultiplier;
  }

  /** True when the hitbox and other debug overlays should be drawn. */
  isDebug(): boolean {
    return this.debug;
  }

  subscribeSettings = (listener: () => void): (() => void) => {
    this.settingsListeners.add(listener);
    return () => this.settingsListeners.delete(listener);
  };

  // --- reminders ----------------------------------------------------------
  // Owned by ReminderCoordinator; the runtime only supplies context.

  /** True while the companion must not be interrupted by a reminder. */
  private isBusyForReminder(): boolean {
    return (
      this.transition.isActive ||
      this.handover.isActive ||
      (this.roamMode === 'reminders-only' && this.reminderVisit.stage !== 'hidden') ||
      this.interaction.isDragging ||
      this.movement.getSnapshot().mode === 'held'
    );
  }

  /**
   * Clears the way for a reminder: awake, still, and not mid-wander.
   *
   * Reminder-only appearances start at a side edge; delivery waits for arrival.
   * While free-roaming, a reminder belonging to a *different* avatar is handed
   * over on foot instead of swapping the artwork where it stands.
   */
  private prepareForReminder(announcement: Announcement): void {
    this.wakeUp();
    this.idleMonitor.markActive();
    this.behavior.interrupt();

    if (this.roamMode === 'reminders-only') {
      if (announcement.avatarId) void this.swapAvatar(announcement.avatarId);
      const cursor = this.interaction.cursorPosition;
      const target = this.settingsStore?.current.display.remindersOnActiveMonitor && cursor
        ? this.displays.displayContaining(cursor)
        : this.pinnedDisplayTarget();
      if (target) this.enterDisplay(target);
      this.movement.stop();
      this.reminderVisit.start(Math.random() < 0.5 ? 'left' : 'right');
      this.updateReminderVisit(0);
      void this.setClickThrough(true);
      return;
    }

    const visitor = announcement.avatarId;
    // An entrance is wanted either because somebody else is delivering this, or
    // because the announcement asked for one. The second case runs the same
    // choreography with the same avatar at both ends of it: the character
    // leaves, comes back in from the edge, says its piece and returns to where
    // it was standing.
    if (visitor && visitor !== this.loadedAvatarId) {
      this.beginHandover(visitor);
      return;
    }
    // Not while the user has asked it to stay put: an entrance means walking
    // off the screen and back, and "never moves by itself" is a promise about
    // exactly that. It speaks from where it stands instead.
    if (announcement.entrance === 'from-edge' && this.roamMode === 'always') {
      this.beginHandover(this.loadedAvatarId);
      return;
    }
  }

  /** True once whoever is delivering the reminder is in place to speak. */
  private isReadyForReminder(): boolean {
    if (this.roamMode === 'reminders-only') return this.reminderVisit.stage === 'present';
    return !this.handover.isActive || this.handover.isPresenting;
  }

  // --- avatar handover ----------------------------------------------------

  /** Sends the roaming character off so the reminder's avatar can walk in. */
  private beginHandover(visitorId: string): void {
    this.transition.cancel();
    this.visitorAvatarId = visitorId;
    this.handover.setSpeed(this.walkSpeed());
    this.handover.start(
      this.movement.getSnapshot().position.x,
      this.boundaries.currentBounds,
      this.boundaries.companionSize,
    );
    this.movement.stop();
    log.info(`Handing the desk over to "${visitorId}"`);
    this.updateHandover(0);
  }

  /**
   * Drives one step of the exchange and applies it.
   *
   * The two swaps happen on the stage transitions into `swapping` and
   * `restoring`, the only stages where the character is fully off screen, and
   * each one holds there until the pack has loaded. A swap anywhere else would
   * be visible as one character turning into another.
   */
  private updateHandover(delta: number): void {
    const before = this.handover.stage;
    this.handover.update(delta, this.boundaries.currentBounds, this.boundaries.companionSize);
    const stage = this.handover.stage;

    if (stage !== before) {
      if (stage === 'swapping') this.fetchHandoverAvatar(this.visitorAvatarId ?? this.chosenAvatarId);
      if (stage === 'restoring') this.fetchHandoverAvatar(this.chosenAvatarId);
    }

    // Applied before the stage is examined, so the last step of the walk home
    // is not dropped on the frame the exchange ends.
    const position = this.handover.position;
    this.movement.setPosition(position, 'idle');

    if (stage === 'idle') {
      if (before !== 'idle') this.endHandover();
      return;
    }

    const outward = this.handover.side === 'left' ? -1 : 1;
    const towards = this.handover.facing === 'outward' ? outward : -outward;
    this.movement.faceToward(position.x + towards * 10_000);

    const animation = handoverAnimation(stage);
    if (animation) {
      this.player.play(animation, { priority: AnimationPriority.CRITICAL, force: before !== stage });
    }
    // Running away reads as running, not as a brisk stroll.
    this.player.setSpeed(this.animationSpeed() * handoverAnimationSpeed(stage));
    for (const listener of [...this.settingsListeners]) listener();
  }

  /** Loads a pack for the current off-screen stage, then lets it continue. */
  private fetchHandoverAvatar(avatarId: string): void {
    void this.swapAvatar(avatarId).finally(() => {
      // The pack that just arrived may walk at a different speed from the one
      // that left, and the rest of the exchange is its walk, not the other's.
      this.handover.setSpeed(this.walkSpeed());
      this.handover.avatarReady();
    });
  }

  /** Puts the companion back to ordinary behaviour after an exchange. */
  private endHandover(): void {
    this.visitorAvatarId = null;
    this.player.setSpeed(this.animationSpeed());
    this.player.play('idle', { priority: AnimationPriority.AMBIENT, force: true });
    log.info('Handover finished');
    for (const listener of [...this.settingsListeners]) listener();
  }

  /**
   * Abandons an exchange in progress, wherever it had got to.
   *
   * Used when something outranks the reminder — the user grabs the companion,
   * or switches roam mode. The chosen avatar is restored immediately rather
   * than walked back in: there is no longer a sequence for it to belong to.
   */
  private abortHandover(): void {
    if (!this.handover.isActive) return;
    this.handover.reset();
    if (this.loadedAvatarId !== this.chosenAvatarId) {
      void this.swapAvatar(this.chosenAvatarId);
    }
    this.endHandover();
  }

  private walkSpeed(): number {
    return this.loadedCharacter.manifest.movement.walkSpeed * this.speedMultiplier;
  }

  private animationSpeed(): number {
    return this.settingsStore?.current.character.animationSpeed ?? 1;
  }

  /** Moves the window inside the display; the renderer clips the edge peek. */
  private updateReminderVisit(delta: number): void {
    const before = this.reminderVisit.stage;
    this.reminderVisit.update(delta);
    const stage = this.reminderVisit.stage;
    if (stage === 'hidden' && before === 'hidden') return;
    if (stage === 'hidden' && this.loadedAvatarId !== this.chosenAvatarId) {
      void this.swapAvatar(this.chosenAvatarId);
    }
    if (stage !== 'hidden') {
      const position = this.reminderVisit.position(this.boundaries.currentBounds, this.boundaries.companionSize);
      this.movement.setPosition(position, 'idle');
      const inward = this.reminderVisit.side === 'left';
      this.movement.faceToward(position.x + ((stage === 'exit' || stage === 'hide') !== inward ? 10000 : -10000));
      if (stage !== 'present') {
        this.player.play(stage === 'enter' || stage === 'exit' ? 'walk' : 'wave', {
          priority: AnimationPriority.CRITICAL,
          force: before !== stage,
        });
      }
    }
    this.player.setSpeed(this.animationSpeed() * (stage === 'exit' ? 2.5 : 1));
    for (const listener of [...this.settingsListeners]) listener();
  }

  get isAvatarVisible(): boolean {
    return this.settingsReady && (this.roamMode !== 'reminders-only' || this.reminderVisit.stage !== 'hidden');
  }

  get isReminderVisitMode(): boolean {
    return this.roamMode === 'reminders-only';
  }

  /**
   * How the character is clipped to its window during an entrance or escape,
   * or null when it is standing on screen as usual.
   *
   * The window cannot leave the work area, so walking off the edge is drawn by
   * sliding the character out of a window that clips it. The renderer needs
   * only these two numbers; which sequence produced them is not its business.
   */
  get entrance(): { readonly offset: number; readonly tilt: number } | null {
    if (this.roamMode === 'reminders-only') {
      const peeking = this.reminderVisit.stage === 'peek';
      return {
        offset: this.reminderVisit.offset,
        tilt: peeking ? (this.reminderVisit.side === 'left' ? 10 : -10) : 0,
      };
    }
    if (!this.handover.isActive) return null;
    const peeking = this.handover.stage === 'peeking';
    return {
      offset: this.handover.offset,
      tilt: peeking ? (this.handover.side === 'left' ? 10 : -10) : 0,
    };
  }

  /** Run away after delivery, retaining any borrowed avatar until hidden. */
  private finishReminder(): void {
    if (this.roamMode === 'reminders-only') {
      this.reminderVisit.leave();
      return;
    }
    if (this.handover.isActive) {
      // The visitor walks out and the roaming character walks back; the swap
      // back happens off screen, part way through.
      this.handover.leave();
      return;
    }
    if (this.loadedAvatarId !== this.chosenAvatarId) {
      void this.swapAvatar(this.chosenAvatarId);
    }
  }

  setRemindersPaused(paused: boolean): void {
    this.reminders.setPaused(paused);
  }

  get areRemindersPaused(): boolean {
    return this.reminders.isPaused;
  }

  /** The text currently in the speech bubble, or null when hidden. */
  getBubbleText(): string | null {
    return this.reminders.getBubbleText();
  }

  subscribeBubble = (listener: () => void): (() => void) =>
    this.reminders.subscribeBubble(listener);

  // --- display mode -------------------------------------------------------

  /**
   * Moves the companion if the current display mode says it belongs elsewhere.
   *
   * Only used for the modes that pin it somewhere. 'roam' and 'follow-me' are
   * handled in the tick, because they depend on what the user is doing.
   */
  private enforceDisplayMode(): void {
    const target = this.pinnedDisplayTarget();
    if (!target || target.id === this.currentDisplay.id) return;
    this.moveToDisplay(target);
  }

  private pinnedDisplayTarget(): DisplayInfo | null {
    if (this.displayMode === 'primary') return this.displays.primary;
    if (this.displayMode === 'specific') {
      // A pinned display that has been unplugged falls back to the primary
      // one rather than leaving the companion nowhere.
      return (
        (this.pinnedDisplayId ? this.displays.byId(this.pinnedDisplayId) : null) ??
        this.displays.primary
      );
    }
    return null;
  }

  /** Follows the user between displays, when the mode asks for it. */
  private updateFollowMe(delta: number): void {
    if (this.displayMode !== 'follow-me') return;
    if (this.transition.isActive || this.reminders.isPerforming || this.interaction.isDragging) {
      return;
    }

    const target = this.activeMonitor.update(
      delta,
      this.interaction.cursorPosition,
      this.currentDisplay,
    );
    if (target) this.moveToDisplay(target);
  }

  /**
   * Sends the companion to another display, walking there when the displays
   * touch and the user allows it, and placing it directly otherwise.
   */
  private moveToDisplay(display: DisplayInfo): void {
    if (this.allowTransitions && this.roamMode !== 'reminders-only') {
      const link = this.topology
        .linksFrom(this.currentDisplay.id)
        .find((candidate) => candidate.to === display.id);
      if (link?.touching) {
        this.behavior.interrupt();
        const started = this.transition.begin(this.currentDisplay.id, link.direction, {
          onEnterDisplay: (entered) => this.enterDisplay(entered),
          onComplete: () => undefined,
        });
        if (started) return;
      }
    }

    // No walkable route, or transitions turned off: place it directly.
    this.enterDisplay(display);
    this.movement.setPosition(this.boundaries.safePosition(), 'idle');
    displayLog.info(`Moved directly to "${display.name}"`);
  }

  // --- sleep --------------------------------------------------------------

  /**
   * Dozes off when the user has been away, and wakes when they return.
   *
   * Sleeping is not just cosmetic: a sleeping companion stops wandering, which
   * is the single biggest saving available while the machine is unattended.
   */
  private updateSleep(): void {
    if (!this.sleepEnabled) return;
    if (!this.idleMonitor.update()) return;

    if (this.idleMonitor.isIdle) {
      this.fallAsleep();
    } else {
      this.wakeUp();
    }
  }

  private fallAsleep(): void {
    if (this.sleeping || this.transition.isActive || this.reminders.isPerforming) return;
    this.sleeping = true;
    this.behavior.interrupt();
    log.info('Companion is sleeping');
    this.player.play('sleep', { priority: AnimationPriority.NORMAL, force: true });
  }

  private wakeUp(): void {
    if (!this.sleeping) return;
    this.sleeping = false;
    log.info('Companion woke up');
    this.player.play('wake', {
      priority: AnimationPriority.REACTION,
      force: true,
      onFinish: () => this.player.play('idle', { priority: AnimationPriority.AMBIENT, force: true }),
    });
  }

  get isSleeping(): boolean {
    return this.sleeping;
  }

  /** The current overlay layout, which the renderer needs to place the bubble. */
  getLayout(): OverlayLayout {
    return this.layout;
  }

  /** Occasionally sends the companion to another display, when idle. */
  private maybeRoam(delta: number): void {
    if (this.displayMode !== 'roam') return;
    if (!this.allowTransitions) return;
    if (this.displays.all.length < 2) return;

    this.sinceLastRoamCheck += delta;
    if (this.sinceLastRoamCheck < ROAM_CHECK_INTERVAL) return;
    this.sinceLastRoamCheck = 0;

    // Only interrupt a settled companion, never one mid-walk.
    if (this.movement.getSnapshot().mode !== 'idle') return;
    if (Math.random() >= ROAM_CHANCE) return;

    const links = this.topology.linksFrom(this.currentDisplay.id);
    const link = links[Math.floor(Math.random() * links.length)];
    if (!link) return;

    this.behavior.interrupt();
    this.transition.begin(this.currentDisplay.id, link.direction, {
      onEnterDisplay: (display) => this.enterDisplay(display),
      onComplete: () => undefined,
    });
  }

  /**
   * Turns the character's position into a window frame and applies it.
   *
   * The window is the character alone unless a speech bubble is showing, in
   * which case it grows to fit the bubble and the character sits in a corner
   * of it. Keeping that entirely here means movement, boundaries and
   * interaction all continue to speak in character coordinates.
   */
  private applyFrame(characterPosition: Vector2): void {
    const workArea = this.boundaries.currentBounds;
    this.layout = computeLayout({
      characterSize: this.boundaries.companionSize,
      characterPosition,
      workArea,
      bubbleVisible: this.reminders.getBubbleText() !== null,
    });

    this.positioner.apply({
      origin: windowOriginFor(this.layout, characterPosition, workArea),
      size: this.layout.windowSize,
    });
  }

  private enterDisplay(display: DisplayInfo): void {
    this.currentDisplay = display;
    this.boundaries.setBounds(display.workArea);
    // No speed rescaling: logical points mean a step covers the same apparent
    // distance on every display, whatever its scale factor.
    displayLog.info(`Companion is now on "${display.name}"`);
  }

  /**
   * Re-homes the companion after the display layout changes.
   *
   * The display it was standing on may have been unplugged, resized or rescaled.
   * The companion must never be left at coordinates no monitor can show.
   */
  private handleDisplayChange(): void {
    this.topology = new MonitorTopology(this.displays.all);
    this.transition.cancel();
    this.transition = new MonitorTransition(
      this.movement,
      this.boundaries,
      this.player,
      this.topology,
    );

    const { position } = this.movement.getSnapshot();
    const stillThere = this.displays.byId(this.currentDisplay.id);
    const target =
      stillThere ??
      this.displays.displayContaining(position) ??
      this.displays.nearestDisplay(position) ??
      this.displays.primary;

    if (!target) {
      displayLog.error('No display available after a layout change');
      return;
    }

    if (target.id !== this.currentDisplay.id) {
      displayLog.warn(
        `Display "${this.currentDisplay.name}" is gone; moving to "${target.name}"`,
      );
    }
    this.enterDisplay(target);
    this.enforceDisplayMode();

    // Clamp into the new work area, and reset to a known-good spot if the old
    // position is not recoverable.
    this.movement.revalidate();
    if (!this.boundaries.isWithin(this.movement.getSnapshot().position)) {
      this.movement.setPosition(this.boundaries.safePosition(), 'idle');
    }
  }

  /**
   * Re-reads reminders and alarms after the settings window changes them.
   *
   * Reading from the database rather than trusting the event's payload keeps
   * one source of truth, and means a reload after a failed write shows what is
   * actually stored.
   */
  private async reloadSchedules(): Promise<void> {
    try {
      const [reminders, alarms] = await Promise.all([
        this.reminderRepository?.loadOrSeed(Date.now()) ?? Promise.resolve(undefined),
        this.alarmRepository?.loadAll() ?? Promise.resolve(undefined),
      ]);
      this.reminders.adoptEdits({
        ...(reminders ? { reminders } : {}),
        ...(alarms ? { alarms } : {}),
      });
      log.info('Reloaded reminders and alarms after an edit');
    } catch (error) {
      log.error('Could not reload the schedules after an edit', error);
    }
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.watcher.stop();
    this.interaction.stop();
    this.reminders.stop();
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
    this.unlistenTray?.();
    this.unlistenTray = null;
    this.unlistenSchedules?.();
    this.unlistenSchedules = null;
    this.sound.dispose();
    // One last write so the very last position is not lost on quit.
    void this.positionStore?.flush();
    this.positionStore?.dispose();
    void this.settingsStore?.dispose();
  }
}


/** What the character does during each stage of a handover. */
function handoverAnimation(stage: HandoverStage): string | null {
  switch (stage) {
    case 'clearing':
    case 'arriving':
    case 'departing':
    case 'returning':
      return 'walk';
    case 'peeking':
      return 'idle';
    // `present` is left alone: the reminder's own animation is playing.
    default:
      return null;
  }
}

/**
 * Playback multiplier per stage, matched to how fast the character is actually
 * travelling in `AvatarHandover` so its feet do not slide.
 */
function handoverAnimationSpeed(stage: HandoverStage): number {
  if (stage === 'clearing') return 2.4;
  if (stage === 'departing') return 1.6;
  if (stage === 'arriving') return 0.7;
  return 1;
}

/**
 * Loads an avatar, falling back to the bundled default.
 *
 * An avatar id comes from settings and may name a pack the user has since
 * deleted, or one whose images no longer decode. Returning the default is
 * always better than an empty overlay the user cannot diagnose.
 */
async function loadWithFallback(
  registry: AvatarRegistry,
  avatarId: string,
): Promise<{ readonly character: LoadedCharacter; readonly avatarId: string }> {
  const ref = await registry.resolve(avatarId);
  if (ref) {
    try {
      return { character: await loadCharacter(ref), avatarId };
    } catch (error) {
      log.error(`Avatar "${avatarId}" could not be loaded`, error);
    }
  }

  if (avatarId === DEFAULT_AVATAR_ID) {
    // Nothing left to fall back to; the caller has to deal with it.
    throw new Error(`The default avatar "${DEFAULT_AVATAR_ID}" could not be loaded`);
  }

  log.warn(`Falling back to "${DEFAULT_AVATAR_ID}"`);
  return {
    character: await loadCharacter(
      (await registry.resolve(DEFAULT_AVATAR_ID)) ?? DEFAULT_AVATAR_ID,
    ),
    avatarId: DEFAULT_AVATAR_ID,
  };
}

/**
 * Waits until the operating system reports at least one monitor.
 *
 * Display enumeration can legitimately come back empty for a moment — while
 * the machine wakes, as a monitor is plugged in, or during a resolution
 * change. Treating that as fatal was observed to leave the overlay permanently
 * blank after a wake, with no way to recover short of restarting, because
 * nothing retried.
 */
async function waitForDisplays(displays: DisplayManager): Promise<void> {
  // Generous, because the worst case is launching at login: the app can be
  // running before the display is awake and before the user has unlocked,
  // and a companion that gave up then would never appear at all.
  const attempts = 60;
  const delayMs = 1000;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    await displays.refresh();
    if (displays.all.length > 0) {
      if (attempt > 1) log.info(`Displays appeared after ${attempt} attempt(s)`);
      return;
    }
    // Logged sparsely: this can legitimately run for a minute at login, and
    // a line a second would bury everything else.
    if (attempt === 1 || attempt % 10 === 0) {
      log.warn(`Waiting for a display (attempt ${attempt}/${attempts})`);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error('The operating system reported no displays');
}

/** Smallest and largest character box worth drawing, in physical pixels. */
const MIN_CHARACTER_PX = 16;
const MAX_CHARACTER_PX = 2048;

/**
 * Keeps the character box to a size that can actually be used.
 *
 * Below the minimum there is nothing to aim a cursor at; above the maximum the
 * overlay covers the screen it is supposed to live on. Both ends would leave
 * the user unable to reach the companion's own right-click menu.
 */
function characterExtent(pixels: number): number {
  if (!Number.isFinite(pixels)) return MIN_CHARACTER_PX;
  return Math.round(Math.min(MAX_CHARACTER_PX, Math.max(MIN_CHARACTER_PX, pixels)));
}
