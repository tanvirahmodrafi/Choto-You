import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnimationPlayer } from '@/animation/AnimationPlayer';
import { SoundPlayer } from '@/services/SoundPlayer';
import { ReminderCoordinator } from './ReminderCoordinator';
import type { Reminder } from './types';

const reminder: Reminder = {
  id: 'test', kind: 'custom', title: 'Test', message: 'Hello!', enabled: true,
  intervalMinutes: 10, animation: 'wave', bubbleSeconds: 2,
  lastTriggered: null, nextTrigger: 1000,
};

function setup() {
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
