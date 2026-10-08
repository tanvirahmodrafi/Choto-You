import { describe, expect, it, vi } from 'vitest';
import { AnimationPlayer } from '@/animation/AnimationPlayer';
import type { AnimationClip } from '@/animation/types';
import { ReminderPerformance } from './ReminderPerformance';
import { announcementFor, type Announcement, type Reminder } from './types';

function clip(name: string, loop = true): AnimationClip {
  return { name, fps: 10, loop, frames: [`${name}/1.png`, `${name}/2.png`] };
}

const CLIPS = new Map(
  [clip('idle'), clip('wave'), clip('drink', false), clip('happy', false)].map((c) => [c.name, c]),
);

const water: Reminder = {
  id: 'water',
  kind: 'water',
  title: 'Drink water',
  message: 'Time to drink some water!',
  enabled: true,
  intervalMinutes: 45,
  animation: 'wave',
  followUpAnimation: 'drink',
  bubbleSeconds: 6,
  lastTriggered: null,
  nextTrigger: 0,
};

/** The reminder as the coordinator would hand it to a performance. */
const announcement = announcementFor(water, 0);

function setup(reminder: Announcement = announcement) {
  const player = new AnimationPlayer(CLIPS);
  const showBubble = vi.fn();
  const hideBubble = vi.fn();
  const performance = new ReminderPerformance(reminder, player, { showBubble, hideBubble });
  return { performance, player, showBubble, hideBubble };
}

function run(performance: ReminderPerformance, seconds: number, step = 1 / 60) {
  for (let t = 0; t < seconds; t += step) performance.update(step);
}

describe('ReminderPerformance', () => {
  it('greets with the reminder animation before saying anything', () => {
    const { performance, player, showBubble } = setup();

    expect(player.currentName).toBe('wave');
    expect(showBubble).not.toHaveBeenCalled();
    expect(performance.currentStage).toBe('greeting');
  });

  it('shows the bubble after the greeting', () => {
    const { performance, showBubble } = setup();
    run(performance, 1);

    expect(showBubble).toHaveBeenCalledWith('Time to drink some water!');
    expect(performance.currentStage).toBe('speaking');
  });

  it('plays the follow-up animation while the bubble is still up', () => {
    const { performance, player, hideBubble } = setup();
    run(performance, 1 + 6 / 3 + 0.1);

    expect(player.currentName).toBe('drink');
    expect(hideBubble).not.toHaveBeenCalled();
  });

  it('hides the bubble and returns to idle', () => {
    const { performance, player, hideBubble } = setup();
    run(performance, 12);

    expect(hideBubble).toHaveBeenCalled();
    expect(performance.isFinished).toBe(true);
    expect(player.currentName).toBe('idle');
  });

  it('keeps the bubble up for the configured time, measured from when it opened', () => {
    const { performance, hideBubble } = setup();

    run(performance, 1);        // greeting over, bubble opens
    run(performance, 5.5);      // still inside the 6s window
    expect(hideBubble).not.toHaveBeenCalled();

    run(performance, 1);
    expect(hideBubble).toHaveBeenCalled();
  });

  it('works for a reminder with no follow-up animation', () => {
    // Built by omission rather than by assigning undefined: the field is
    // genuinely optional under exactOptionalPropertyTypes.
    const { followUpAnimation: _omitted, ...withoutFollowUp } = announcement;
    const { performance, player, hideBubble } = setup({
      ...withoutFollowUp,
      animation: 'happy',
    });

    run(performance, 12);
    expect(hideBubble).toHaveBeenCalled();
    expect(player.currentName).toBe('idle');
  });

  it('can be dismissed early and hides the bubble when it is', () => {
    const { performance, hideBubble } = setup();
    run(performance, 2);

    performance.cancel();

    expect(hideBubble).toHaveBeenCalled();
    expect(performance.isFinished).toBe(true);
  });

  it('does nothing further once finished', () => {
    const { performance, hideBubble } = setup();
    run(performance, 12);
    const callsWhenDone = hideBubble.mock.calls.length;

    run(performance, 10);
    expect(hideBubble).toHaveBeenCalledTimes(callsWhenDone);
  });

  it('falls back to idle when the character lacks the reminder animation', () => {
    const { player } = setup({ ...announcement, animation: 'backflip' });
    // A missing animation must not stop the reminder being shown.
    expect(player.currentName).toBe('idle');
  });
});
