import { logger } from '../utils/logger';

export interface CacheOptions {
  ttlMs: number; // fetch again after this long
  maxStaleMs: number; // after failed fetches the last good value keeps serving, but never older than this
  retryAfterMs?: number; // after a failed fetch, wait this long before trying again
}

export interface Cached<T> {
  get(force?: boolean): Promise<T | undefined>; // fetches when the value is older than ttlMs, or when forced
  peek(): T | undefined; // the last good value within maxStaleMs, never fetches
}

/**
 * Wraps a fetcher with a TTL cache, one request in flight at a time, a stale fallback,
 * and a pause after failures so a down source does not slow every request
 */
export function cached<T>(name: string, fetcher: () => Promise<T>, options: CacheOptions): Cached<T> {
  const { ttlMs, maxStaleMs, retryAfterMs = 60 * 1000 } = options;
  let last: { value: T; fetchedAt: number } | null = null;
  let failedAt = 0;
  let inflight: Promise<T | undefined> | null = null;

  const peek = (): T | undefined => (last && Date.now() - last.fetchedAt < maxStaleMs ? last.value : undefined);

  const get = (force = false): Promise<T | undefined> => {
    if (inflight) return inflight;
    if (!force && last && Date.now() - last.fetchedAt < ttlMs) return Promise.resolve(last.value);
    if (!force && Date.now() - failedAt < retryAfterMs) return Promise.resolve(peek());

    inflight = fetcher()
      .then((value) => {
        last = { value, fetchedAt: Date.now() };
        return value;
      })
      .catch((error) => {
        failedAt = Date.now();
        logger.warn(`Failed to fetch ${name}: ${error instanceof Error ? error.message : error}`);
        return peek();
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  return { get, peek };
}
