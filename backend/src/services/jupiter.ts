import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import axiosRetry from 'axios-retry';

/**
 * Clients for Jupiter's APIs (swap quotes and transactions, Lend, prices) on lite-api.jup.ag, with JUPITER_API_KEY
 * when set (Jupiter checks it there too). The key stays server-side. JUPITER_API_URL, JUPITER_LEND_API_URL and
 * JUPITER_PRICE_API_URL override the base, for example to move to api.jup.ag on a paid plan.
 *
 * Jupiter limits requests per second, and ten live quotes fired at once got refused on Render. So every swap and
 * Lend call goes through one queue: at most JUPITER_MAX_CONCURRENT at once (2), started at least
 * JUPITER_MIN_GAP_MS apart (250 ms). A 429 waits 0.5, 1 and 2 seconds before retrying.
 */

export function jupiterBase(path: 'swap/v1' | 'lend/v1' | 'price/v3'): string {
  return `https://lite-api.jup.ag/${path}`;
}

const MAX_CONCURRENT = Number(process.env.JUPITER_MAX_CONCURRENT || 2);
const MIN_GAP_MS = Number(process.env.JUPITER_MIN_GAP_MS || 250);
let active = 0;
let lastStart = 0;
const waiting: (() => void)[] = [];

function pump() {
  if (active >= MAX_CONCURRENT || waiting.length === 0) return;
  const wait = Math.max(0, lastStart + MIN_GAP_MS - Date.now());
  if (wait > 0) {
    setTimeout(pump, wait);
    return;
  }
  active += 1;
  lastStart = Date.now();
  waiting.shift()!();
  pump();
}

function acquire(): Promise<void> {
  return new Promise((resolve) => {
    waiting.push(resolve);
    pump();
  });
}

function release() {
  active = Math.max(0, active - 1);
  pump();
}

type QueuedConfig = InternalAxiosRequestConfig & { _queued?: boolean };

/**
 * A Jupiter client for one API (`swap/v1`, `lend/v1`), with the key, the queue and retries on 429
 */
export function createJupiterClient(path: 'swap/v1' | 'lend/v1' = 'swap/v1', override?: string): AxiosInstance {
  const apiKey = process.env.JUPITER_API_KEY;
  const client = axios.create({
    baseURL: override || jupiterBase(path),
    timeout: 15000,
    headers: apiKey ? { 'x-api-key': apiKey } : undefined,
  });

  client.interceptors.request.use(async (config: QueuedConfig) => {
    await acquire();
    config._queued = true;
    return config;
  });
  // Registered before axios-retry, so the slot is free again before a retry asks for one
  client.interceptors.response.use(
    (response) => {
      if ((response.config as QueuedConfig)._queued) release();
      return response;
    },
    (error) => {
      if ((error?.config as QueuedConfig | undefined)?._queued) release();
      throw error;
    }
  );

  axiosRetry(client, {
    retries: 3,
    // 0.5 s, 1 s, 2 s and some jitter: Jupiter's limit is per second
    retryDelay: (retryCount, error) => axiosRetry.exponentialDelay(retryCount, error, 500),
    retryCondition: (error) => axiosRetry.isNetworkOrIdempotentRequestError(error) || error.response?.status === 429,
  });

  return client;
}

/**
 * Headers for one-off Jupiter calls made with another client (prices, Lend rates)
 */
export function jupiterHeaders(): Record<string, string> | undefined {
  return process.env.JUPITER_API_KEY ? { 'x-api-key': process.env.JUPITER_API_KEY } : undefined;
}
