import { useCallback, useEffect, useState } from 'react';
import {
  createAlarm,
  formatTime,
  LEAD_CHOICES,
  parseTime,
  scheduleAlarm,
  type Alarm,
} from '@/alarms/types';
import { AlarmRepository } from '@/database/AlarmRepository';
import { ReminderRepository } from '@/database/ReminderRepository';
import { broadcastScheduleChange } from '@/database/scheduleEvents';
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

type Tab = 'general' | 'character' | 'display' | 'reminders' | 'alarms' | 'behavior' | 'advanced';

const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'character', label: 'Character' },
  { id: 'display', label: 'Display' },
  { id: 'reminders', label: 'Reminders' },
  { id: 'alarms', label: 'Alarms' },
  { id: 'behavior', label: 'Behavior' },
  { id: 'advanced', label: 'Advanced' },
];

interface Loaded {
  readonly store: SettingsStore;
  readonly reminderRepository: ReminderRepository;
  readonly alarmRepository: AlarmRepository;
}

export function SettingsApp() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [reminders, setReminders] = useState<readonly Reminder[]>([]);
  const [alarms, setAlarms] = useState<readonly Alarm[]>([]);
  const [displays, setDisplays] = useState<readonly DisplayInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('general');

  useEffect(() => {
    let cancelled = false;

    async function start(): Promise<void> {
      const store = await SettingsStore.open();
      const reminderRepository = await ReminderRepository.open();
      const loadedReminders = await reminderRepository.loadOrSeed(Date.now());
      const alarmRepository = await AlarmRepository.open();
      const loadedAlarms = await alarmRepository.loadAll();

      const displayManager = new DisplayManager();
      await displayManager.refresh();

      if (cancelled) {
        await store.dispose();
        return;
      }
      setLoaded({ store, reminderRepository, alarmRepository });
      setSettings(store.current);
      setReminders(loadedReminders);
      setAlarms(loadedAlarms);
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

  /**
   * Writes, then tells the overlay to re-read.
   *
   * Without the broadcast an edit here would sit in the database until the next
   * launch — survivable for a reminder's interval, useless for an alarm the
   * user has just set for ten minutes' time.
   */
  const saved = useCallback(async (write: Promise<void> | undefined): Promise<void> => {
    await write;
    await broadcastScheduleChange();
  }, []);

  const updateReminder = useCallback(
    async (reminder: Reminder): Promise<void> => {
      await saved(loaded?.reminderRepository.save(reminder));
      setReminders((current) =>
        current.map((candidate) => (candidate.id === reminder.id ? reminder : candidate)),
      );
    },
    [loaded, saved],
  );

  const addReminder = useCallback(async (reminder: Reminder): Promise<void> => {
    await saved(loaded?.reminderRepository.save(reminder, reminders.length));
    setReminders((current) => [...current, reminder]);
  }, [loaded, reminders.length, saved]);

  const removeReminder = useCallback(
    (id: string) => {
      setReminders((current) => current.filter((candidate) => candidate.id !== id));
      void saved(loaded?.reminderRepository.remove(id));
    },
    [loaded, saved],
  );

  const updateAlarm = useCallback(
    async (alarm: Alarm): Promise<void> => {
      await saved(loaded?.alarmRepository.save(alarm));
      setAlarms((current) =>
        current.map((candidate) => (candidate.id === alarm.id ? alarm : candidate)),
      );
    },
    [loaded, saved],
  );

  const addAlarm = useCallback(async (alarm: Alarm): Promise<void> => {
    await saved(loaded?.alarmRepository.save(alarm, alarms.length));
    setAlarms((current) => [...current, alarm]);
  }, [alarms.length, loaded, saved]);

  const removeAlarm = useCallback(
    (id: string) => {
      setAlarms((current) => current.filter((candidate) => candidate.id !== id));
      void saved(loaded?.alarmRepository.remove(id));
    },
    [loaded, saved],
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
      <aside className="sidebar">
        <div className="brand">
          <img className="brand__mark" src="/characters/rafi/thumbnail.png" alt="" />
          <div>
            <strong>Choto You</strong>
            <span>Companion settings</span>
          </div>
        </div>
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
        <p className="sidebar__note">Changes in most sections apply immediately. Reminders and alarms wait for Save.</p>
      </aside>

      <div className="panel">
        <header className="panel__header">
          <h1>{TABS.find((entry) => entry.id === tab)?.label}</h1>
          <p>{TAB_DESCRIPTIONS[tab]}</p>
        </header>
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
        {tab === 'alarms' ? (
          <AlarmsPanel
            alarms={alarms}
            onChange={updateAlarm}
            onAdd={addAlarm}
            onRemove={removeAlarm}
          />
        ) : null}
        {tab === 'behavior' ? <BehaviorPanel settings={settings} update={update} /> : null}
        {tab === 'advanced' ? <AdvancedPanel settings={settings} store={loaded?.store} /> : null}
      </div>
    </main>
  );
}

const TAB_DESCRIPTIONS: Readonly<Record<Tab, string>> = {
  general: 'Choose how Choto You starts, sounds, and stays visible.',
  character: 'Pick who lives on your desktop and how they move.',
  display: 'Decide which screen your companion calls home.',
  reminders: 'Set the gentle nudges your companion brings throughout the day.',
  alarms: 'Choose exact moments when your companion should come find you.',
  behavior: 'Shape how often your companion wanders and reacts.',
  advanced: 'Tune performance, diagnostics, and reset options.',
};

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
  onChange: (reminder: Reminder) => Promise<void>;
  onAdd: (reminder: Reminder) => Promise<void>;
  onRemove: (id: string) => void;
}) {
  const avatars = useAvatarList();
  const [newReminder, setNewReminder] = useState<Reminder | null>(null);

  return (
    <Section title="Reminders">
      {reminders.length === 0 ? <p className="muted">No reminders yet.</p> : null}
      {reminders.map((reminder) => (
        <ReminderEditor
          key={reminder.id}
          reminder={reminder}
          avatars={avatars}
          onSave={onChange}
          onDelete={isCustom(reminder) ? () => onRemove(reminder.id) : undefined}
        />
      ))}
      {newReminder ? (
        <ReminderEditor
          reminder={newReminder}
          avatars={avatars}
          isNew
          onSave={async (reminder) => {
            await onAdd(reminder);
            setNewReminder(null);
          }}
          onCancel={() => setNewReminder(null)}
        />
      ) : (
        <div className="collection-action">
          <div>
            <strong>Add a reminder</strong>
            <span>Your own message, on your own schedule</span>
          </div>
          <Button tone="primary" onClick={() => setNewReminder(createCustomReminder(Date.now()))}>
            New reminder
          </Button>
        </div>
      )}
    </Section>
  );
}

function ReminderEditor({
  reminder,
  avatars,
  onSave,
  onDelete,
  onCancel,
  isNew = false,
}: {
  reminder: Reminder;
  avatars: readonly AvatarSummary[];
  onSave: (reminder: Reminder) => Promise<void>;
  onDelete?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
  isNew?: boolean;
}) {
  const [draft, setDraft] = useState(reminder);
  const [saving, setSaving] = useState(false);
  const dirty = isNew || JSON.stringify(draft) !== JSON.stringify(reminder);

  useEffect(() => setDraft(reminder), [reminder]);

  const saveDraft = async () => {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="schedule-editor" data-dirty={dirty ? 'true' : 'false'}>
      <div className="schedule-editor__heading">
        <div>
          <strong>{isNew ? 'New reminder' : draft.title}</strong>
          <span>{draft.enabled ? `Every ${draft.intervalMinutes} minutes` : 'Paused'}</span>
        </div>
        <Toggle
          label={`Enable ${draft.title}`}
          checked={draft.enabled}
          onChange={(enabled) => setDraft({ ...draft, enabled })}
        />
      </div>
      {isCustom(draft) ? (
        <Row
          label="Name"
          control={
            <input
              className="text-input"
              value={draft.title}
              aria-label="Reminder name"
              onChange={(event) => setDraft({ ...draft, title: event.currentTarget.value })}
            />
          }
        />
      ) : null}
      {isCustom(draft) ? (
        <Row
          label="Message"
          control={
            <input
              className="text-input"
              value={draft.message}
              aria-label="Reminder message"
              onChange={(event) => setDraft({ ...draft, message: event.currentTarget.value })}
            />
          }
        />
      ) : (
        <p className="schedule-editor__message">“{draft.message}”</p>
      )}
      {draft.enabled ? (
        <Row
          label="Every"
          control={
            <Slider
              label={`${draft.title} interval`}
              min={5}
              max={180}
              step={5}
              value={draft.intervalMinutes}
              format={(value) => `${value} min`}
              onChange={(intervalMinutes) =>
                setDraft({
                  ...draft,
                  intervalMinutes,
                  nextTrigger: Date.now() + intervalMinutes * 60_000,
                })
              }
            />
          }
        />
      ) : null}
      {draft.enabled ? (
        <Row
          label="Avatar"
          hint="Who delivers this one"
          control={
            <Choice
              label={`${draft.title} avatar`}
              value={draft.avatarId ?? ''}
              options={[
                { value: '', label: 'Whoever is on screen' },
                ...avatars.map((avatar) => ({ value: avatar.id, label: avatar.name })),
              ]}
              onChange={(avatarId) =>
                setDraft({ ...draft, avatarId: avatarId === '' ? null : avatarId })
              }
            />
          }
        />
      ) : null}
      <div className="schedule-editor__actions">
        {onDelete ? (
          <Button tone="danger" onClick={onDelete}>Delete</Button>
        ) : <span />}
        <div className="schedule-editor__commit">
          {dirty && !isNew ? <Button onClick={() => setDraft(reminder)}>Cancel</Button> : null}
          {onCancel ? <Button onClick={onCancel}>Cancel</Button> : null}
          <Button tone="primary" disabled={!dirty || saving} onClick={() => void saveDraft()}>
            {saving ? 'Saving…' : 'Save reminder'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The Alarms tab.
 *
 * An alarm is the inverse of a reminder: the user names a moment rather than an
 * interval, and the useful part is usually the warning a few minutes beforehand
 * rather than the moment itself — being told at eight that the meeting is at
 * eight is too late to do anything about.
 */
function AlarmsPanel({
  alarms,
  onChange,
  onAdd,
  onRemove,
}: {
  alarms: readonly Alarm[];
  onChange: (alarm: Alarm) => Promise<void>;
  onAdd: (alarm: Alarm) => Promise<void>;
  onRemove: (id: string) => void;
}) {
  const avatars = useAvatarList();
  const [newAlarm, setNewAlarm] = useState<Alarm | null>(null);

  return (
    <Section title="Alarms">
      {alarms.length === 0 ? (
        <p className="muted">
          No alarms yet. An alarm goes off at a time you choose — and can send the companion
          out a few minutes beforehand to warn you.
        </p>
      ) : null}

      {alarms.map((alarm) => (
        <AlarmEditor
          key={alarm.id}
          alarm={alarm}
          avatars={avatars}
          onSave={onChange}
          onDelete={() => onRemove(alarm.id)}
        />
      ))}

      {newAlarm ? (
        <AlarmEditor
          alarm={newAlarm}
          avatars={avatars}
          isNew
          onSave={async (alarm) => {
            await onAdd(alarm);
            setNewAlarm(null);
          }}
          onCancel={() => setNewAlarm(null)}
        />
      ) : (
        <div className="collection-action">
          <div>
            <strong>Add an alarm</strong>
            <span>A time, and what to say when it comes round</span>
          </div>
          <Button tone="primary" onClick={() => setNewAlarm(createAlarm(Date.now()))}>
            New alarm
          </Button>
        </div>
      )}
      <p className="section-note">
        Alarms still go off while reminders are paused. An alarm is a moment you asked for.
      </p>
    </Section>
  );
}

function AlarmEditor({
  alarm,
  avatars,
  onSave,
  onDelete,
  onCancel,
  isNew = false,
}: {
  alarm: Alarm;
  avatars: readonly AvatarSummary[];
  onSave: (alarm: Alarm) => Promise<void>;
  onDelete?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
  isNew?: boolean;
}) {
  const [draft, setDraft] = useState(alarm);
  const [saving, setSaving] = useState(false);
  const dirty = isNew || JSON.stringify(draft) !== JSON.stringify(alarm);

  useEffect(() => setDraft(alarm), [alarm]);

  const saveDraft = async () => {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="schedule-editor" data-dirty={dirty ? 'true' : 'false'}>
      <div className="schedule-editor__heading">
        <div>
          <strong>{isNew ? 'New alarm' : draft.label}</strong>
          <span>{draft.enabled ? `${formatTime(draft.atMinutes)}${draft.repeatDaily ? ' · daily' : ' · once'}` : 'Off'}</span>
        </div>
        <Toggle
          label={`Enable ${draft.label}`}
          checked={draft.enabled}
          onChange={(enabled) =>
            setDraft(enabled ? scheduleAlarm({ ...draft, enabled }, Date.now()) : { ...draft, enabled })
          }
        />
      </div>
          <Row
            label="What for"
            control={
              <input
                className="text-input"
                value={draft.label}
                aria-label="Alarm name"
                placeholder="Standup"
                onChange={(event) => setDraft({ ...draft, label: event.currentTarget.value })}
              />
            }
          />
          <Row
            label="At"
            hint={draft.repeatDaily ? 'Every day' : 'The next time this comes round'}
            control={
              <input
                className="text-input"
                type="time"
                value={formatTime(draft.atMinutes)}
                aria-label="Alarm time"
                onChange={(event) => {
                  const atMinutes = parseTime(event.currentTarget.value);
                  if (atMinutes === null) return;
                  setDraft(scheduleAlarm({ ...draft, atMinutes }, Date.now()));
                }}
              />
            }
          />
          <Row
            label="Repeat daily"
            hint={draft.repeatDaily ? undefined : 'Off: it goes off once, then switches itself off'}
            control={
              <Toggle
                label={`Repeat ${draft.label} daily`}
                checked={draft.repeatDaily}
                onChange={(repeatDaily) => setDraft({ ...draft, repeatDaily })}
              />
            }
          />
          <Row
            label="Warn me"
            hint="A first visit this long before the alarm itself"
            control={
              <Choice
                label={`${draft.label} warning`}
                value={String(draft.leadMinutes)}
                options={LEAD_CHOICES.map((minutes) => ({
                  value: String(minutes),
                  label: minutes === 0 ? 'Not at all' : `${minutes} minutes before`,
                }))}
                onChange={(value) =>
                  setDraft({ ...draft, leadMinutes: Number(value), leadDone: false })
                }
              />
            }
          />
          <Row
            label="Message"
            hint="What it says. Left empty, it says the name above"
            control={
              <input
                className="text-input"
                value={draft.message}
                aria-label="Alarm message"
                placeholder={`${draft.label.trim() || 'Alarm'} — it's time.`}
                onChange={(event) => setDraft({ ...draft, message: event.currentTarget.value })}
              />
            }
          />
          <Row
            label="Avatar"
            hint="Who delivers it"
            control={
              <Choice
                label={`${draft.label} avatar`}
                value={draft.avatarId ?? ''}
                options={[
                  { value: '', label: 'Whoever is on screen' },
                  ...avatars.map((avatar) => ({ value: avatar.id, label: avatar.name })),
                ]}
                onChange={(avatarId) =>
                  setDraft({ ...draft, avatarId: avatarId === '' ? null : avatarId })
                }
              />
            }
          />
      <div className="schedule-editor__actions">
        {onDelete ? <Button tone="danger" onClick={onDelete}>Delete</Button> : <span />}
        <div className="schedule-editor__commit">
          {dirty && !isNew ? <Button onClick={() => setDraft(alarm)}>Cancel</Button> : null}
          {onCancel ? <Button onClick={onCancel}>Cancel</Button> : null}
          <Button tone="primary" disabled={!dirty || saving} onClick={() => void saveDraft()}>
            {saving ? 'Saving…' : 'Save alarm'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Spelled out per mode, because "only when reminding me" is not self-evident. */
const ROAM_HINTS: Readonly<Record<RoamMode, string>> = {
  always: 'Wanders around your screen on its own.',
  'reminders-only': 'Stays hidden, peeks around a screen edge, steps into that corner with a reminder, then runs away.',
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
