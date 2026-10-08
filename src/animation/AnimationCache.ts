import { createLogger } from '@/utils/logger';

const log = createLogger('ANIM');

/**
 * Decoded-image cache for sprite frames.
 *
 * Frames are loaded and decoded once, up front, then held for the lifetime of
 * the character. Decoding ahead of time matters: handing the browser an
 * undecoded image mid-animation causes a visible hitch on the first loop.
 *
 * The cache is keyed by URL, so two animations sharing a frame share one image.
 */
export class AnimationCache {
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly pending = new Map<string, Promise<HTMLImageElement | null>>();

  /**
   * Loads and decodes every URL. Individual failures are logged and resolved as
   * `null` rather than rejecting, so one missing frame cannot fail a whole
   * character load — the player skips frames it has no image for.
   *
   * @returns the URLs that failed to load.
   */
  async preload(urls: readonly string[]): Promise<string[]> {
    const unique = [...new Set(urls)];
    const results = await Promise.all(unique.map((url) => this.load(url)));
    const failed = unique.filter((_, index) => results[index] === null);
    if (failed.length > 0) {
      log.warn(`${failed.length} of ${unique.length} frames failed to load`, failed.slice(0, 5));
    } else {
      log.debug(`Preloaded ${unique.length} frames`);
    }
    return failed;
  }

  has(url: string): boolean {
    return this.images.has(url);
  }

  get(url: string): HTMLImageElement | undefined {
    return this.images.get(url);
  }

  clear(): void {
    this.images.clear();
    this.pending.clear();
  }

  private load(url: string): Promise<HTMLImageElement | null> {
    const cached = this.images.get(url);
    if (cached) return Promise.resolve(cached);

    const inFlight = this.pending.get(url);
    if (inFlight) return inFlight;

    const promise = this.loadImage(url)
      .then((image) => {
        this.images.set(url, image);
        return image;
      })
      .catch((error: unknown) => {
        log.warn(`Frame failed to load: ${url}`, error);
        return null;
      })
      .finally(() => {
        this.pending.delete(url);
      });

    this.pending.set(url, promise);
    return promise;
  }

  private async loadImage(url: string): Promise<HTMLImageElement> {
    const image = new Image();
    image.src = url;
    // `decode()` resolves only once the pixels are ready to paint.
    await image.decode();
    return image;
  }
}
