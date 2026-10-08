import { describe, expect, it } from 'vitest';
import { ReminderVisit } from './ReminderVisit';

const bounds = { x: -1920, y: -200, width: 1920, height: 1080 };
const size = { width: 120, height: 120 };

describe('reminder-only visit', () => {
  it('stays hidden until a reminder arrives', () => {
    const visit = new ReminderVisit();
    visit.update(500);
    expect(visit.stage).toBe('hidden');
    visit.start('left');
    expect(visit.stage).toBe('peek');
    expect(visit.offset).toBe(-1);
    visit.update(1);
    expect(visit.offset).toBeCloseTo(-0.52);
    expect(visit.position(bounds, size).x).toBe(bounds.x);
  });

  it.each(['left', 'right'] as const)('enters from the %s edge and waits at the centre', (side) => {
    const visit = new ReminderVisit();
    visit.start(side);
    visit.update(1.6);
    expect(visit.stage).toBe('enter');
    expect(visit.position(bounds, size).x).toBe(side === 'left' ? -1920 : -120);
    visit.update(2);
    expect(visit.stage).toBe('present');
    expect(visit.position(bounds, size)).toEqual({ x: -1020, y: 280 });
    expect(visit.offset).toBe(0);
    visit.update(60);
    expect(visit.stage).toBe('present');
  });

  it('runs back faster than entry and disappears beyond the edge', () => {
    const visit = new ReminderVisit();
    visit.start('right');
    visit.update(4);
    visit.leave();
    visit.update(0.45);
    expect(visit.position(bounds, size).x).toBe(-570);
    visit.update(0.45);
    expect(visit.stage).toBe('hide');
    expect(visit.position(bounds, size).x).toBe(-120);
    visit.update(0.2);
    expect(visit.offset).toBeGreaterThan(0.5);
    visit.update(0.2);
    expect(visit.stage).toBe('hidden');
  });

  it('handles long ticks and resets without leaving a half-visible avatar', () => {
    const visit = new ReminderVisit();
    visit.start('left');
    visit.update(20);
    expect(visit.stage).toBe('present');
    visit.leave();
    visit.update(20);
    expect(visit.stage).toBe('hidden');
    visit.start('right');
    visit.update(0.5);
    visit.reset();
    expect(visit.stage).toBe('hidden');
  });
});
