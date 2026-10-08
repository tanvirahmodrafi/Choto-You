import type { Rect, Vector2 } from '@/movement/types';

export type VisitStage = 'hidden' | 'peek' | 'enter' | 'present' | 'exit' | 'hide';

/** A reminder's entrance and escape, independent of frame rate and OS windows. */
export class ReminderVisit {
  stage: VisitStage = 'hidden';
  private elapsed = 0;
  side: 'left' | 'right' = 'left';

  start(side: 'left' | 'right'): void {
    this.side = side;
    this.stage = 'peek';
    this.elapsed = 0;
  }

  leave(): void {
    if (this.stage === 'hidden') return;
    this.stage = 'exit';
    this.elapsed = 0;
  }

  reset(): void {
    this.stage = 'hidden';
    this.elapsed = 0;
  }

  update(delta: number): void {
    this.elapsed += Math.max(0, delta);
    const durations = { peek: 1.6, enter: 2, exit: 0.9, hide: 0.35 };
    const next = { peek: 'enter', enter: 'present', exit: 'hide', hide: 'hidden' } as const;
    while (this.stage !== 'hidden' && this.stage !== 'present') {
      const duration = durations[this.stage];
      if (this.elapsed < duration) break;
      this.elapsed -= duration;
      this.stage = next[this.stage];
    }
  }

  get offset(): number {
    const sign = this.side === 'left' ? -1 : 1;
    if (this.stage === 'peek') {
      // Slowly reveal the head and near hand, pause, then emerge.
      return sign * (1 - 0.48 * Math.min(1, this.elapsed / 0.65));
    }
    if (this.stage === 'enter') return sign * 0.52 * Math.max(0, 1 - this.elapsed / 0.3);
    if (this.stage === 'hide') return sign * Math.min(1, this.elapsed / 0.35);
    return 0;
  }

  position(bounds: Rect, size: { width: number; height: number }): Vector2 {
    const left = bounds.x;
    const right = Math.max(left, bounds.x + bounds.width - size.width);
    const centre = (left + right) / 2;
    const edge = this.side === 'left' ? left : right;
    let x = edge;
    if (this.stage === 'present') x = centre;
    if (this.stage === 'enter') {
      const t = Math.min(1, this.elapsed / 2);
      x = edge + (centre - edge) * t * t * (3 - 2 * t);
    }
    if (this.stage === 'exit') x = centre + (edge - centre) * Math.min(1, this.elapsed / 0.9);
    // Stand on the bottom of the work area, the same ground the companion
    // walks on the rest of the time — a reminder that floats in at the
    // vertical centre of the display reads as a popup, not as the character
    // sneaking in.
    return { x, y: bounds.y + Math.max(0, bounds.height - size.height) };
  }
}
