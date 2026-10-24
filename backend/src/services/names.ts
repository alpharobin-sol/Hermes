import { PublicKey } from '@solana/web3.js';
import { getMultiplePrimaryDomains } from '@bonfida/spl-name-service';
import { logger } from '../utils/logger';
import { connection } from './rates';

/**
 * WALLET NAMES
 * A wallet's primary SNS name (for example "duke.sns"), so the site can show it in place of the address.
 * Read on chain with SNS's SDK, which leaves out a primary name the wallet no longer owns. SNS has moved from .sol
 * to .sns (the SDK rejects .sol reads from slot 452,825,395), so names show with .sns.
 * Each wallet's answer, a name or none, is kept for an hour. A failed read isn't kept, so the next one retries.
 */

const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 5000;
const cache = new Map<string, { at: number; name: Promise<string | null> }>();

export function primaryName(address: string): Promise<string | null> {
  const now = Date.now();
  const hit = cache.get(address);
  if (hit && now - hit.at < TTL_MS) return hit.name;

  const name = getMultiplePrimaryDomains(connection, [new PublicKey(address)])
    .then(([reverse]) => (reverse ? `${reverse}.sns` : null))
    .catch((error) => {
      logger.info(`Primary name lookup failed for ${address}: ${error instanceof Error ? error.message : error}`);
      cache.delete(address);
      return null;
    });
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(address, { at: now, name });
  return name;
}
