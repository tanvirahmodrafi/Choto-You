import { describe, expect, it, vi } from 'vitest';
import { AnimationPlayer } from './AnimationPlayer';
import { AnimationPriority, type AnimationClip } from './types';

function clips(...entries: AnimationClip[]): Map<string, AnimationClip> {
  return new Map(entries.map((clip) => [clip.name, clip]));
}

const idle: AnimationClip = {
  name: 'idle',
  fps: 10,
  loop: true,
  frames: ['idle/1.png', 'idle/2.png', 'idle/3.png'],
};

const wave: AnimationClip = {
  name: 'wave',
  fps: 10,
  loop: false,
  frames: ['wave/1.png', 'wave/2.png'],
};

describe('AnimationPlayer', () => {
  it('starts on idle and exposes the first frame', () => {
    const player = new AnimationPlayer(clips(idle));
    expect(player.currentName).toBe('idle');
    expect(player.getState().frameUrl).toBe('idle/1.png');
  });

  it('advances frames based on elapsed time, not tick count', () => {
    const player = new AnimationPlayer(clips(idle));
    // 10fps => 0.1s per frame. Many small ticks must equal one frame step.
    for (let i = 0; i < 10; i++) player.update(0.01);
    expect(player.getState().frameIndex).toBe(1);
  });

  it('does not advance before a frame is due', () => {
    const player = new AnimationPlayer(clips(idle));
    player.update(0.09);
    expect(player.getState().frameIndex).toBe(0);
  });

  it('consumes a long delta across several frames instead of dropping time', () => {
    const player = new AnimationPlayer(clips(idle));
    player.update(0.25); // 2.5 frames at 10fps
    expect(player.getState().frameIndex).toBe(2);
  });

  it('loops a looping clip', () => {
    const player = new AnimationPlayer(clips(idle));
    player.update(0.3); // exactly 3 frames, wrapping back to 0
    expect(player.getState().frameIndex).toBe(0);
    expect(player.isFinished).toBe(false);
  });

  it('holds the last frame of a non-looping clip and fires onFinish once', () => {
    const onFinish = vi.fn();
    const player = new AnimationPlayer(clips(idle, wave));
    player.play('wave', { onFinish });

    player.update(0.5);
    expect(player.isFinished).toBe(true);
    expect(player.getState().frameUrl).toBe('wave/2.png');
    expect(onFinish).toHaveBeenCalledTimes(1);

    player.update(0.5);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('refuses a lower-priority request while a higher one is playing', () => {
    const player = new AnimationPlayer(clips(idle, wave));
    player.play('wave', { priority: AnimationPriority.CRITICAL });

    expect(player.play('idle', { priority: AnimationPriority.AMBIENT })).toBe(false);
    expect(player.currentName).toBe('wave');
  });

  it('accepts a lower-priority request once the clip has finished', () => {
    const player = new AnimationPlayer(clips(idle, wave));
    player.play('wave', { priority: AnimationPriority.CRITICAL });
    player.update(0.5);

    expect(player.play('idle', { priority: AnimationPriority.AMBIENT })).toBe(true);
    expect(player.currentName).toBe('idle');
  });

  it('honours force regardless of priority', () => {
    const player = new AnimationPlayer(clips(idle, wave));
    player.play('wave', { priority: AnimationPriority.CRITICAL });

    expect(player.play('idle', { priority: AnimationPriority.AMBIENT, force: true })).toBe(true);
    expect(player.currentName).toBe('idle');
  });

  it('does not restart a clip that is already playing', () => {
    const player = new AnimationPlayer(clips(idle));
    player.update(0.1);
    expect(player.getState().frameIndex).toBe(1);

    player.play('idle');
    expect(player.getState().frameIndex).toBe(1);
  });

  it('restarts when explicitly asked', () => {
    const player = new AnimationPlayer(clips(idle));
    player.update(0.1);

    player.play('idle', { restart: true });
    expect(player.getState().frameIndex).toBe(0);
  });

  it('falls back to idle when an animation is missing', () => {
    const player = new AnimationPlayer(clips(idle));
    expect(player.play('backflip')).toBe(true);
    expect(player.currentName).toBe('idle');
  });

  it('plays faster when the speed is raised', () => {
    const player = new AnimationPlayer(clips(idle));
    player.setSpeed(2);

    // 10fps at double speed is one frame per 0.05s.
    player.update(0.05);
    expect(player.getState().frameIndex).toBe(1);
  });

  it('plays slower when the speed is lowered', () => {
    const player = new AnimationPlayer(clips(idle));
    player.setSpeed(0.5);

    player.update(0.1);
    expect(player.getState().frameIndex).toBe(0);
    player.update(0.1);
    expect(player.getState().frameIndex).toBe(1);
  });

  it('clamps the speed to a sane range', () => {
    const player = new AnimationPlayer(clips(idle));
    // A speed of zero would freeze every animation with no way back.
    player.setSpeed(0);
    player.update(1);
    expect(player.getState().frameIndex).not.toBe(0);
  });

  it('notifies subscribers when the frame changes', () => {
    const player = new AnimationPlayer(clips(idle));
    const listener = vi.fn();
    player.subscribe(listener);

    player.update(0.1);
    expect(listener).toHaveBeenCalled();
  });

  it('returns a stable snapshot between frame changes', () => {
    const player = new AnimationPlayer(clips(idle));
    const first = player.getState();
    player.update(0.01);
    // useSyncExternalStore requires referential stability or it loops forever.
    expect(player.getState()).toBe(first);
  });
});

/**
 * Still-image avatar packs are built entirely from one-frame clips, which the
 * player used to skip over entirely in `update`. A non-looping one that never
 * completes keeps its priority forever, which locks out every later request.
 */
describe('AnimationPlayer with single-frame clips', () => {
  const still = (name: string, loop: boolean): AnimationClip => ({
    name,
    fps: 2,
    loop,
    frames: [`${name}.png`],
  });

  it('completes a non-looping still and reports it once', () => {
    const onFinish = vi.fn();
    const player = new AnimationPlayer(clips(still('idle', true), still('land', false)));

    player.play('land', { priority: AnimationPriority.REACTION, onFinish });
    expect(player.isFinished).toBe(false);

    // 2fps => the single frame lasts half a second.
    player.update(0.5);
    expect(player.isFinished).toBe(true);
    expect(onFinish).toHaveBeenCalledTimes(1);

    player.update(0.5);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('releases its priority once finished, so later requests are honoured', () => {
    const player = new AnimationPlayer(clips(still('idle', true), still('land', false)));

    player.play('land', { priority: AnimationPriority.CRITICAL });
    // Nothing lower may interrupt while it is still playing.
    expect(player.play('idle', { priority: AnimationPriority.AMBIENT })).toBe(false);

    player.update(0.5);
    expect(player.play('idle', { priority: AnimationPriority.AMBIENT })).toBe(true);
    expect(player.currentName).toBe('idle');
  });

  it('holds a looping still indefinitely', () => {
    const player = new AnimationPlayer(clips(still('idle', true)));

    for (let i = 0; i < 100; i++) player.update(0.1);

    expect(player.isFinished).toBe(false);
    expect(player.getState().frameIndex).toBe(0);
    expect(player.getState().frameUrl).toBe('idle.png');
  });
});

describe('AnimationPlayer.setClips', () => {
  it('keeps the pose and frame when the new pack has a matching clip', () => {
    const player = new AnimationPlayer(clips(idle, wave));
    player.play('idle', { restart: true });
    player.update(0.1);
    expect(player.getState().frameIndex).toBe(1);

    player.setClips(clips({ ...idle, frames: ['new/1.png', 'new/2.png', 'new/3.png'] }, wave));

    expect(player.currentName).toBe('idle');
    // Same pose, same length: the walk does not visibly restart.
    expect(player.getState().frameIndex).toBe(1);
    expect(player.getState().frameUrl).toBe('new/2.png');
  });

  it('falls back to idle when the new pack lacks the current pose', () => {
    const player = new AnimationPlayer(clips(idle, wave));
    player.play('wave', { priority: AnimationPriority.CRITICAL });

    player.setClips(clips(idle));

    expect(player.currentName).toBe('idle');
    expect(player.getState().frameIndex).toBe(0);
  });

  it('drops a pending onFinish when the pose is lost, since it can never fire', () => {
    const onFinish = vi.fn();
    const player = new AnimationPlayer(clips(idle, wave));
    player.play('wave', { onFinish });

    player.setClips(clips(idle));
    for (let i = 0; i < 10; i++) player.update(0.1);

    expect(onFinish).not.toHaveBeenCalled();
  });

  it('keeps priority when the pose survives, so a reminder still owns the character', () => {
    const player = new AnimationPlayer(clips(idle, wave));
    player.play('wave', { priority: AnimationPriority.CRITICAL });

    player.setClips(clips(idle, wave));

    expect(player.currentName).toBe('wave');
    expect(player.play('idle', { priority: AnimationPriority.AMBIENT })).toBe(false);
  });

  it('keeps a pending onFinish when the pose survives', () => {
    const onFinish = vi.fn();
    const player = new AnimationPlayer(clips(idle, wave));
    player.play('wave', { onFinish });

    player.setClips(clips(idle, wave));
    // wave is 2 frames at 10fps and does not loop.
    for (let i = 0; i < 5; i++) player.update(0.1);

    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('releases priority when the pose is lost, so the character is not stuck', () => {
    const player = new AnimationPlayer(clips(idle, wave));
    player.play('wave', { priority: AnimationPriority.CRITICAL });

    player.setClips(clips(idle));

    expect(player.currentName).toBe('idle');
    expect(player.play('idle', { priority: AnimationPriority.AMBIENT, restart: true })).toBe(true);
  });

  it('ignores an empty clip set rather than leaving nothing to draw', () => {
    const player = new AnimationPlayer(clips(idle));

    player.setClips(new Map());

    expect(player.currentName).toBe('idle');
    expect(player.getState().frameUrl).toBe('idle/1.png');
  });
});
