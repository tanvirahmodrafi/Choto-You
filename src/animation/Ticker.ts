import { createLogger } from '@/utils/logger';

const log = createLogger('ANIM');

export type TickListener = (deltaSeconds: number) => void;

/** A gap longer than this between frames means something is wrong, not slow. */
const STALL_THRESHOLD_MS = 900;

/**
 * One shared requestAnimationFrame loop for the whole overlay.
 *
 * Every animated system (animation playback, movement, physics) subscribes
 * here rather than starting its own rAF or interval. That keeps the companion
 * to a single timer, and lets the loop stop entirely when nothing is
 * subscribed or the companion is hidden.
 *
 * Note on visibility: the loop deliberately does *not* listen for
 * `visibilitychange`. In a macOS webview `document.hidden` becomes true
 * whenever the application is merely inactive — which, for an always-on-top
 * companion, is the normal case while the user works in another app. Honouring
 * it froze the character on screen. Suspension is therefore an explicit
 * decision (`setPaused`), made when the companion is actually hidden.
 */
export class Ticker {
  private listeners = new Set<TickListener>();
  private frameHandle: number | null = null;
  private lastTimestamp = 0;
  private running = false;
  private paused = false;
  private minFrameSeconds = 0;
  private accumulated = 0;

  constructor(private readonly maxDeltaSeconds = 0.1) {}

  subscribe(listener: TickListener): () => void {
    this.listeners.add(listener);
    this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  /** True while the rAF loop is scheduled. Exposed for diagnostics and tests. */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Caps how often subscribers are ticked.
   *
   * requestAnimationFrame still runs at the display's rate — it cannot be
   * slowed — so frames are coalesced instead: elapsed time is accumulated and
   * delivered in one larger delta once the budget is reached. Movement stays
   * correct because everything downstream is delta-based.
   */
  setMaxFps(fps: number): void {
    const clamped = Math.min(240, Math.max(1, fps));
    // A hair under the exact budget, so a 60fps cap is not sawn in half by a
    // 60Hz display delivering frames a fraction early.
    this.minFrameSeconds = clamped >= 240 ? 0 : (1 / clamped) * 0.9;
  }

  /** Suspends or resumes the loop, e.g. when the companion is hidden. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      log.debug('Companion hidden; suspending animation loop');
      this.stop();
    } else {
      log.debug('Companion shown; resuming animation loop');
      this.start();
    }
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
  }

  private start(): void {
    if (this.running || this.paused || this.listeners.size === 0) return;
    this.running = true;
    this.lastTimestamp = performance.now();
    this.frameHandle = requestAnimationFrame(this.step);
  }

  private stop(): void {
    this.running = false;
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  /**
   * Warns if the loop stalls.
   *
   * WebKit throttles a webview it considers hidden — rAF stops entirely and
   * timers drop to about 1Hz — which freezes the companion mid-step with no
   * error anywhere. That happened in practice when another app went
   * fullscreen and the overlay was left behind on the old Space. A frozen
   * companion must never be silent again.
   */
  private checkForStall(timestamp: number): void {
    const gap = timestamp - this.lastTimestamp;
    if (gap < STALL_THRESHOLD_MS) return;
    log.warn(
      `Animation loop stalled for ${Math.round(gap)}ms; the webview is probably ` +
        'being throttled because the overlay is off-screen',
    );
  }

  private readonly step = (timestamp: number): void => {
    if (!this.running) return;
    this.checkForStall(timestamp);

    // Clamped so a stall (sleep, heavy GC, the window being occluded) cannot
    // deliver a huge delta that teleports movement or skips whole animations.
    const delta = Math.min((timestamp - this.lastTimestamp) / 1000, this.maxDeltaSeconds);
    this.lastTimestamp = timestamp;

    this.accumulated += delta;
    if (this.accumulated < this.minFrameSeconds) {
      this.frameHandle = requestAnimationFrame(this.step);
      return;
    }
    const tickDelta = this.accumulated;
    this.accumulated = 0;

    // Copy before iterating: a listener may unsubscribe during its own tick.
    for (const listener of [...this.listeners]) {
      try {
        listener(tickDelta);
      } catch (error) {
        // One misbehaving subscriber must not kill the loop for everything else.
        log.error('Tick listener threw', error);
      }
    }

    this.frameHandle = requestAnimationFrame(this.step);
  };
}

/** The overlay's single ticker instance. */
export const ticker = new Ticker();
