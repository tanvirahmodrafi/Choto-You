import { createLogger } from '@/utils/logger';

const log = createLogger('APP');

/**
 * Plays the companion's optional sound effects.
 *
 * Sound is always optional: every call is best-effort, and a missing or
 * unplayable file is logged once and then ignored. Nothing about the
 * companion's behaviour depends on a sound having played.
 *
 * Browsers block audio until a page has been interacted with. The overlay is
 * rarely clicked, so a blocked play is treated as ordinary and not retried in
 * a loop.
 */
export class SoundPlayer {
  private readonly cache = new Map<string, HTMLAudioElement>();
  private readonly failed = new Set<string>();
  private enabled = true;
  private volume = 0.5;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
  }

  /**
   * Plays a sound by URL. Returns immediately; nothing waits on audio.
   */
  play(url: string | undefined): void {
    if (!this.enabled || !url || this.failed.has(url)) return;

    const audio = this.cache.get(url) ?? this.create(url);
    audio.volume = this.volume;
    // Restart rather than ignore: two reminders close together should both
    // be heard.
    audio.currentTime = 0;

    void audio.play().catch((error: unknown) => {
      // Logged once per sound. A companion that cannot play audio should not
      // fill the log with the same complaint every reminder.
      if (!this.failed.has(url)) {
        this.failed.add(url);
        log.warn(`Could not play "${url}"; sounds for it are disabled`, error);
      }
    });
  }

  private create(url: string): HTMLAudioElement {
    const audio = new Audio(url);
    audio.preload = 'auto';
    this.cache.set(url, audio);
    return audio;
  }

  dispose(): void {
    for (const audio of this.cache.values()) audio.pause();
    this.cache.clear();
  }
}
