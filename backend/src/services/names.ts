import { PublicKey } from '@solana/web3.js';
import { getMultiplePrimaryDomains } from '@bonfida/spl-name-service';
import { getMainDomainChecked } from '@onsol/tldparser';
import { logger } from '../utils/logger';
import { connection } from './rates';

/**
 * WALLET NAMES
 * The name a wallet goes by, so the site can show it in place of the address, the way Titan does:
 * - SNS first: the wallet's primary SNS name, shown bare ("alpharobin"), as Titan shows it. SNS moved from .sol to
 *   .sns, so the ending is left off. Read with SNS's SDK, which leaves out a name the wallet no longer owns.
 * - AllDomains next: the wallet's main domain, shown with its ending ("fatcat.wen"), since AllDomains has many.
 *   Read with AllDomains' parser, checked against who owns the name now, NFT-held names included.
 * Both are plain account reads. Each wallet's answer, a name or none, is kept for an hour. A failed read isn't
 * kept, so the next one retries.
 */

export interface WalletName {
  name: string;
  service: 'sns' | 'alldomains';
}

const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 5000;
const cache = new Map<string, { at: number; name: Promise<WalletName | null> }>();

async function lookUp(address: string): Promise<WalletName | null> {
  const [sns, ans] = await Promise.allSettled([
    getMultiplePrimaryDomains(connection, [new PublicKey(address)]),
    getMainDomainChecked(connection, address),
  ]);
  if (sns.status === 'fulfilled' && sns.value[0]) return { name: sns.value[0], service: 'sns' };
  if (ans.status === 'fulfilled' && ans.value.mainDomain) return { name: ans.value.mainDomain, service: 'alldomains' };
  // Both failed (not just empty): don't keep the answer
  if (sns.status === 'rejected' && ans.status === 'rejected') throw sns.reason;
  return null;
}

export function walletName(address: string): Promise<WalletName | null> {
  const now = Date.now();
  const hit = cache.get(address);
  if (hit && now - hit.at < TTL_MS) return hit.name;

  const name = lookUp(address).catch((error) => {
    logger.info(`Wallet name lookup failed for ${address}: ${error instanceof Error ? error.message : error}`);
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
