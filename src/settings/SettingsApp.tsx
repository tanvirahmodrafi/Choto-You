import { useCallback, useEffect, useState } from 'react';
import { ReminderRepository } from '@/database/ReminderRepository';
import { DisplayManager } from '@/displays/DisplayManager';
import type { DisplayInfo } from '@/displays/types';
import { createCustomReminder, isCustom, type Reminder } from '@/reminders/types';
import { createLogger } from '@/utils/logger';
import { isAutostartEnabled, setAutostart } from './autostart';
import { SettingsStore } from './SettingsStore';
import { Button, Choice, Row, Section, Slider, Toggle } from './components/Controls';
import { AvatarPicker } from './components/AvatarPicker';
import { AvatarRegistry, type AvatarSummary } from '@/characters/AvatarRegistry';
import type { RoamMode, Settings } from './types';

const log = createLogger('APP');

type Tab = 'general' | 'character' | 'display' | 'reminders' | 'behavior' | 'advanced';

const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'character', label: 'Character' },
  { id: 'display', label: 'Display' },
  { id: 'reminders', label: 'Reminders' },
  { id: 'behavior', label: 'Behavior' },
  { id: 'advanced', label: 'Advanced' },
];

interface Loaded {
  readonly store: SettingsStore;
  readonly reminderRepository: ReminderRepository;
}

export function SettingsApp() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [reminders, setReminders] = useState<readonly Reminder[]>([]);
  const [displays, setDisplays] = useState<readonly DisplayInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('general');

  useEffect(() => {
    let cancelled = false;

    async function start(): Promise<void> {
      const store = await SettingsStore.open();
      const reminderRepository = await ReminderRepository.open();
      const loadedReminders = await reminderRepository.loadOrSeed(Date.now());

      const displayManager = new DisplayManager();
      await displayManager.refresh();

      if (cancelled) {
        await store.dispose();
        return;
      }
      setLoaded({ store, reminderRepository });
      setSettings(store.current);
      setReminders(loadedReminders);
      setDisplays(displayManager.all);

      // The OS is the truth for autostart: the user may have removed the login
      // item outside the app. Reconcile rather than trusting what we stored.
      const actualAutostart = await isAutostartEnabled();
      if (actualAutostart !== store.current.general.startWithComputer) {
        await store.update({ general: { startWithComputer: actualAutostart } });
      }
      // The overlay can change settings too, so follow along rather than
      // assuming this window is the only writer.
      store.subscribe(setSettings);
    }

    start().catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      log.error('Settings failed to load', message);
      if (!cancelled) setError(message);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback(
    (patch: Parameters<SettingsStore['update']>[0]) => {
      void loaded?.store.update(patch);
    },
    [loaded],
  );

  const updateReminder = useCallback(
    (reminder: Reminder) => {
      setReminders((current) =>
        current.map((candidate) => (candidate.id === reminder.id ? reminder : candidate)),
      );
      void loaded?.reminderRepository.save(reminder);
    },
    [loaded],
  );

  const addReminder = useCallback(() => {
    const reminder = createCustomReminder(Date.now());
    setReminders((current) => [...current, reminder]);
    void loaded?.reminderRepository.save(reminder, 100);
  }, [loaded]);

  const removeReminder = useCallback(
    (id: string) => {
      setReminders((current) => current.filter((candidate) => candidate.id !== id));
      void loaded?.reminderRepository.remove(id);
    },
    [loaded],
  );

  if (error !== null) {
    return (
      <main className="settings settings--message">
        <h1>Settings unavailable</h1>
        <p>{error}</p>
        <p className="muted">The companion keeps running with its current settings.</p>
      </main>
    );
  }

  if (!settings) {
    return (
      <main className="settings settings--message">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  return (
    <main className="settings">
      <nav className="tabs" aria-label="Settings sections">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="tabs__tab"
            data-active={tab === entry.id ? 'true' : 'false'}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <div className="panel">
        {tab === 'general' ? <GeneralPanel settings={settings} update={update} /> : null}
        {tab === 'character' ? <CharacterPanel settings={settings} update={update} /> : null}
        {tab === 'display' ? (
          <DisplayPanel settings={settings} update={update} displays={displays} />
        ) : null}
        {tab === 'reminders' ? (
          <RemindersPanel
            reminders={reminders}
            onChange={updateReminder}
            onAdd={addReminder}
            onRemove={removeReminder}
          />
        ) : null}
        {tab === 'behavior' ? <BehaviorPanel settings={settings} update={update} /> : null}
        {tab === 'advanced' ? <AdvancedPanel settings={settings} store={loaded?.store} /> : null}
      </div>
    </main>
  );
}

type UpdateFn = (patch: Parameters<SettingsStore['update']>[0]) => void;

function GeneralPanel({ settings, update }: { settings: Settings; update: UpdateFn }) {
  const { general } = settings;

  // Writing the setting is not enough — the login item has to be created or
  // removed, and the OS may refuse. Store what actually happened.
  const changeAutostart = (wanted: boolean) => {
    void setAutostart(wanted).then((actual) =>
      update({ general: { startWithComputer: actual } }),
    );
  };

  return (
    <Section title="General">
      <Row
        label="Start with computer"
        hint="Launch the companion after you log in"
        control={
          <Toggle
            label="Start with computer"
            checked={general.startWithComputer}
            onChange={changeAutostart}
          />
        }
      />
      <Row
        label="Launch minimized"
        hint="Start in the tray without showing the companion"
        control={
          <Toggle
            label="Launch minimized"
            checked={general.launchMinimized}
            onChange={(launchMinimized) => update({ general: { launchMinimized } })}
          />
        }
      />
      <Row
        label="Sound"
        control={
          <Toggle
            label="Sound"
            checked={general.soundEnabled}
            onChange={(soundEnabled) => update({ general: { soundEnabled } })}
          />
        }
      />
      <Row
        label="Show companion"
        hint="Hide it without quitting"
        control={
          <Toggle
            label="Show companion"
            checked={general.companionVisible}
            onChange={(companionVisible) => update({ general: { companionVisible } })}
          />
        }
      />
    </Section>
  );
}

function CharacterPanel({ settings, update }: { settings: Settings; update: UpdateFn }) {
  const { character } = settings;
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  return (
    <Section title="Character">
      <Row
        label="Avatar"
        hint="Who lives on your desktop"
        stack
        control={
          <AvatarPicker
            selectedId={character.characterId}
            onSelect={(characterId) => update({ character: { characterId } })}
            onArtworkChanged={() =>
              update({ character: { avatarRevision: character.avatarRevision + 1 } })
            }
          />
        }
      />
      <Row
        label="Size"
        control={
          <Slider
            label="Size"
            min={0.5}
            max={3}
            step={0.1}
            value={character.scale}
            format={percent}
            onChange={(scale) => update({ character: { scale } })}
          />
        }
      />
      <Row
        label="Movement speed"
        control={
          <Slider
            label="Movement speed"
            min={0.25}
            max={4}
            step={0.25}
            value={character.speedMultiplier}
            format={percent}
            onChange={(speedMultiplier) => update({ character: { speedMultiplier } })}
          />
        }
      />
      <Row
        label="Animation speed"
        control={
          <Slider
            label="Animation speed"
            min={0.25}
            max={4}
            step={0.25}
            value={character.animationSpeed}
            format={percent}
            onChange={(animationSpeed) => update({ character: { animationSpeed } })}
          />
        }
      />
      <Row
        label="Autonomous behavior"
        hint="Wander and act on its own"
        control={
          <Toggle
            label="Autonomous behavior"
            checked={character.autonomousBehavior}
            onChange={(autonomousBehavior) => update({ character: { autonomousBehavior } })}
          />
        }
      />
    </Section>
  );
}

function DisplayPanel({
  settings,
  update,
  displays,
}: {
  settings: Settings;
  update: UpdateFn;
  displays: readonly DisplayInfo[];
}) {
  const { display } = settings;
  return (
    <Section title="Companion location">
      <Row
        label="Where it lives"
        control={
          <Choice
            label="Where it lives"
            value={display.mode}
            onChange={(mode) => update({ display: { mode } })}
            options={[
              { value: 'follow-me', label: 'Follow me' },
              { value: 'roam', label: 'Roam across all displays' },
              { value: 'primary', label: 'Primary display' },
              { value: 'specific', label: 'A specific display' },
            ]}
          />
        }
      />
      {display.mode === 'specific' ? (
        <Row
          label="Display"
          control={
            <Choice
              label="Display"
              value={display.specificDisplayId ?? displays[0]?.id ?? ''}
              onChange={(specificDisplayId) => update({ display: { specificDisplayId } })}
              options={displays.map((candidate) => ({
                value: candidate.id,
                label: `${candidate.name}${candidate.isPrimary ? ' (primary)' : ''}`,
              }))}
            />
          }
        />
      ) : null}
      <Row
        label="Allow display switching"
        control={
          <Toggle
            label="Allow display switching"
            checked={display.allowMonitorTransitions}
            onChange={(allowMonitorTransitions) => update({ display: { allowMonitorTransitions } })}
          />
        }
      />
      <Row
        label="Show reminders on the active display"
        control={
          <Toggle
            label="Show reminders on the active display"
            checked={display.remindersOnActiveMonitor}
            onChange={(remindersOnActiveMonitor) =>
              update({ display: { remindersOnActiveMonitor } })
            }
          />
        }
      />
      <Row
        label="Remember last position"
        control={
          <Toggle
            label="Remember last position"
            checked={display.rememberPosition}
            onChange={(rememberPosition) => update({ display: { rememberPosition } })}
          />
        }
      />
    </Section>
  );
}

/**
 * The avatars a reminder can be assigned to.
 *
 * Read here rather than threaded down from the top: the reminders tab is the
 * only other place that needs the list, and it needs nothing else about them.
 */
function useAvatarList(): readonly AvatarSummary[] {
  const [avatars, setAvatars] = useState<readonly AvatarSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    void new AvatarRegistry()
      .list()
      .then((listed) => {
        if (!cancelled) setAvatars(listed);
      })
      .catch((error: unknown) => {
        // A reminder keeps whatever avatar it already names; the picker just
        // cannot offer alternatives.
        log.warn('Could not list avatars for the reminder picker', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return avatars;
}

function RemindersPanel({
  reminders,
  onChange,
  onAdd,
  onRemove,
}: {
  reminders: readonly Reminder[];
  onChange: (reminder: Reminder) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const avatars = useAvatarList();
  return (
    <Section title="Reminders">
      {reminders.length === 0 ? <p className="muted">No reminders yet.</p> : null}
      {reminders.map((reminder) => (
        <div className="reminder" key={reminder.id}>
          {isCustom(reminder) ? (
            // Only user-created reminders can be renamed or removed; the
            // built-ins are part of what the companion is for.
            <Row
              label="Name"
              control={
                <input
                  className="text-input"
                  value={reminder.title}
                  aria-label="Reminder name"
                  onChange={(event) => onChange({ ...reminder, title: event.currentTarget.value })}
                />
              }
            />
          ) : null}
          <Row
            label={isCustom(reminder) ? 'Enabled' : reminder.title}
            hint={isCustom(reminder) ? undefined : reminder.message}
            control={
              <Toggle
                label={`Enable ${reminder.title}`}
                checked={reminder.enabled}
                onChange={(enabled) => onChange({ ...reminder, enabled })}
              />
            }
          />
          {isCustom(reminder) ? (
            <Row
              label="Message"
              control={
                <input
                  className="text-input"
                  value={reminder.message}
                  aria-label="Reminder message"
                  onChange={(event) =>
                    onChange({ ...reminder, message: event.currentTarget.value })
                  }
                />
              }
            />
          ) : null}
          {reminder.enabled ? (
            <Row
              label="Every"
              control={
                <Slider
                  label={`${reminder.title} interval`}
                  min={5}
                  max={180}
                  step={5}
                  value={reminder.intervalMinutes}
                  format={(value) => `${value} min`}
                  onChange={(intervalMinutes) =>
                    onChange({
                      ...reminder,
                      intervalMinutes,
                      // Restart the cycle from now, so a shortened interval
                      // does not fire instantly from an old timestamp.
                      nextTrigger: Date.now() + intervalMinutes * 60_000,
                    })
                  }
                />
              }
            />
          ) : null}
          {reminder.enabled ? (
            <Row
              label="Avatar"
              hint="Who delivers this one"
              control={
                <Choice
                  label={`${reminder.title} avatar`}
                  value={reminder.avatarId ?? ''}
                  options={[
                    { value: '', label: 'Whoever is on screen' },
                    ...avatars.map((avatar) => ({ value: avatar.id, label: avatar.name })),
                  ]}
                  onChange={(avatarId) =>
                    onChange({ ...reminder, avatarId: avatarId === '' ? null : avatarId })
                  }
                />
              }
            />
          ) : null}
          {isCustom(reminder) ? (
            <Row
              label="Remove"
              control={
                <Button tone="danger" onClick={() => onRemove(reminder.id)}>
                  Delete
                </Button>
              }
            />
          ) : null}
        </div>
      ))}
      <Row
        label="Add a reminder"
        hint="Your own message, on your own schedule"
        control={<Button onClick={onAdd}>Add</Button>}
      />
    </Section>
  );
}

/** Spelled out per mode, because "only when reminding me" is not self-evident. */
const ROAM_HINTS: Readonly<Record<RoamMode, string>> = {
  always: 'Wanders around your screen on its own.',
  'reminders-only': 'Stays hidden, peeks around a screen edge, comes to the centre with a reminder, then runs away.',
  never: 'Never moves by itself. You can still drag it anywhere.',
};

function BehaviorPanel({ settings, update }: { settings: Settings; update: UpdateFn }) {
  const { behavior } = settings;
  return (
    <Section title="Behavior">
      <Row
        label="Moving about"
        hint={ROAM_HINTS[behavior.roamMode]}
        control={
          <Choice
            label="Moving about"
            value={behavior.roamMode}
            options={[
              { value: 'always', label: 'Roam freely' },
              { value: 'reminders-only', label: 'Only when reminding me' },
              { value: 'never', label: 'Stay put' },
            ]}
            onChange={(roamMode) => update({ behavior: { roamMode } })}
          />
        }
      />
      <Row
        label="Sleep when idle"
        control={
          <Toggle
            label="Sleep when idle"
            checked={behavior.sleepWhenIdle}
            onChange={(sleepWhenIdle) => update({ behavior: { sleepWhenIdle } })}
          />
        }
      />
      <Row
        label="React to the mouse"
        control={
          <Toggle
            label="React to the mouse"
            checked={behavior.mouseReactions}
            onChange={(mouseReactions) => update({ behavior: { mouseReactions } })}
          />
        }
      />
      <Row
        label="Look at the cursor"
        control={
          <Toggle
            label="Look at the cursor"
            checked={behavior.cursorTracking}
            onChange={(cursorTracking) => update({ behavior: { cursorTracking } })}
          />
        }
      />
      <Row
        label="Activity"
        hint="How often it does something on its own"
        control={
          <Choice
            label="Activity"
            value={behavior.intensity}
            onChange={(intensity) => update({ behavior: { intensity } })}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'normal', label: 'Normal' },
              { value: 'active', label: 'Active' },
            ]}
          />
        }
      />
    </Section>
  );
}

function AdvancedPanel({
  settings,
  store,
}: {
  settings: Settings;
  store: SettingsStore | undefined;
}) {
  const { advanced } = settings;
  const [confirmingReset, setConfirmingReset] = useState(false);

  return (
    <Section title="Advanced">
      <Row
        label="Debug mode"
        hint="Draw the hitbox and log verbosely"
        control={
          <Toggle
            label="Debug mode"
            checked={advanced.debugMode}
            onChange={(debugMode) => void store?.update({ advanced: { debugMode } })}
          />
        }
      />
      <Row
        label="Frame rate limit"
        hint="Lower uses less battery"
        control={
          <Slider
            label="Frame rate limit"
            min={15}
            max={120}
            step={15}
            value={advanced.maxFps}
            format={(value) => `${value} fps`}
            onChange={(maxFps) => void store?.update({ advanced: { maxFps } })}
          />
        }
      />
      <Row
        label="Reset settings"
        hint="Put everything back to its default"
        control={
          confirmingReset ? (
            <div className="confirm">
              <Button
                tone="danger"
                onClick={() => {
                  void store?.resetToDefaults();
                  setConfirmingReset(false);
                }}
              >
                Reset everything
              </Button>
              <Button onClick={() => setConfirmingReset(false)}>Cancel</Button>
            </div>
          ) : (
            <Button onClick={() => setConfirmingReset(true)}>Reset…</Button>
          )
        }
      />
    </Section>
  );
}
