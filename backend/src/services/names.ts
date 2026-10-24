import { getMainDomainChecked } from '@onsol/tldparser';
import { logger } from '../utils/logger';
import { connection } from './rates';

/**
 * WALLET NAMES
 * A wallet's main AllDomains name (for example "fatcat.wen" or "duke.abc"), so the site can show it in place of the
 * address. Read on chain with AllDomains' parser (@onsol/tldparser): the main domain the wallet set, checked against
 * who owns the name now, including names held as NFTs, so a name the wallet sold doesn't show.
 * Each wallet's answer, a name or none, is kept for an hour. A failed read isn't kept, so the next one retries.
 */

const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 5000;
const cache = new Map<string, { at: number; name: Promise<string | null> }>();

export function primaryName(address: string): Promise<string | null> {
  const now = Date.now();
  const hit = cache.get(address);
  if (hit && now - hit.at < TTL_MS) return hit.name;

  const name = getMainDomainChecked(connection, address)
    .then(({ mainDomain }) => mainDomain ?? null)
    .catch((error) => {
      logger.info(`Main domain lookup failed for ${address}: ${error instanceof Error ? error.message : error}`);
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
