import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnimationPlayer } from '@/animation/AnimationPlayer';
import { SoundPlayer } from '@/services/SoundPlayer';
import type { Alarm } from '@/alarms/types';
import { ReminderCoordinator } from './ReminderCoordinator';
import type { Reminder } from './types';

const reminder: Reminder = {
  id: 'test', kind: 'custom', title: 'Test', message: 'Hello!', enabled: true,
  intervalMinutes: 10, animation: 'wave', bubbleSeconds: 2,
  lastTriggered: null, nextTrigger: 1000,
};

/** An alarm due at `at`, with no early warning. */
function alarmAt(at: number): Alarm {
  return {
    id: 'standup', label: 'Standup', message: '', enabled: true,
    atMinutes: new Date(at).getHours() * 60 + new Date(at).getMinutes(),
    repeatDaily: false, leadMinutes: 0, avatarId: null,
    nextTrigger: at, leadDone: false, lastTriggered: null,
  };
}

function setup(options: { readonly alarms?: readonly Alarm[] } = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const player = new AnimationPlayer(new Map(['idle', 'wave'].map((name) => [name, {
    name, fps: 6, loop: true, frames: [`${name}.png`],
  }])));
  const host = {
    player,
    isBusy: vi.fn(() => false),
    prepareForReminder: vi.fn(),
    isReadyForReminder: vi.fn(() => false),
    finishReminder: vi.fn(),
  };
  const sound = new SoundPlayer();
  const play = vi.spyOn(sound, 'play').mockImplementation(() => undefined);
  const coordinator = new ReminderCoordinator(host, sound);
  coordinator.adopt({ saveAll: vi.fn(async () => undefined) }, [reminder]);
  if (options.alarms) {
    coordinator.adoptAlarms({ saveAll: vi.fn(async () => undefined) }, options.alarms);
  }
  vi.advanceTimersByTime(1000);
  coordinator.update(0);
  return { coordinator, host, play };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('reminder entrance gating', () => {
  it('delays sound and bubble until the host has arrived', () => {
    const { coordinator, host, play } = setup();
    expect(host.prepareForReminder).toHaveBeenCalledOnce();
    expect(coordinator.isPerforming).toBe(true);
    coordinator.update(10);
    expect(play).not.toHaveBeenCalled();
    expect(coordinator.getBubbleText()).toBeNull();
    host.isReadyForReminder.mockReturnValue(true);
    coordinator.update(0);
    expect(play).toHaveBeenCalledOnce();
    coordinator.update(0.8);
    expect(coordinator.getBubbleText()).toBe('Hello!');
    coordinator.update(2);
    expect(coordinator.getBubbleText()).toBeNull();
    coordinator.update(0.2);
    expect(host.finishReminder).toHaveBeenCalledOnce();
    coordinator.stop();
  });

  it('cancels an entrance without delivering the pending message later', () => {
    const { coordinator, host, play } = setup();
    coordinator.cancelCurrent();
    expect(host.finishReminder).toHaveBeenCalledOnce();
    host.isReadyForReminder.mockReturnValue(true);
    coordinator.update(10);
    expect(coordinator.isPerforming).toBe(false);
    expect(play).not.toHaveBeenCalled();
    expect(coordinator.getBubbleText()).toBeNull();
    coordinator.stop();
  });
});

describe('alarms alongside reminders', () => {
  it('shows the alarm first when both come due together', () => {
    const { coordinator, host } = setup({ alarms: [alarmAt(1000)] });

    // Both were due at the same tick; the alarm outranks the reminder, so it is
    // the one the companion is sent out for.
    expect(host.prepareForReminder).toHaveBeenCalledOnce();
    expect(host.prepareForReminder.mock.calls[0]?.[0]).toMatchObject({
      key: 'alarm:standup',
      entrance: 'from-edge',
    });
    coordinator.stop();
  });

  it('still rings while reminders are paused', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const player = new AnimationPlayer(
      new Map([['idle', { name: 'idle', fps: 6, loop: true, frames: ['idle.png'] }]]),
    );
    const host = {
      player,
      isBusy: vi.fn(() => false),
      prepareForReminder: vi.fn(),
      isReadyForReminder: vi.fn(() => true),
      finishReminder: vi.fn(),
    };
    const sound = new SoundPlayer();
    vi.spyOn(sound, 'play').mockImplementation(() => undefined);
    const coordinator = new ReminderCoordinator(host, sound);

    coordinator.setPaused(true);
    coordinator.adopt({ saveAll: vi.fn(async () => undefined) }, [reminder]);
    coordinator.adoptAlarms({ saveAll: vi.fn(async () => undefined) }, [alarmAt(1000)]);

    vi.advanceTimersByTime(1000);
    coordinator.update(0);

    // Pausing is about the companion interrupting on its own. An alarm is a
    // moment the user chose, and its schedule has already moved past this
    // occurrence — suppressing it would lose it for good.
    expect(host.prepareForReminder).toHaveBeenCalledOnce();
    expect(host.prepareForReminder.mock.calls[0]?.[0]).toMatchObject({ key: 'alarm:standup' });
    coordinator.stop();
  });
});
