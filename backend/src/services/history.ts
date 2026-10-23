import { Pool } from 'pg';
import { logger } from '../utils/logger';

/**
 * HERMES HISTORY
 * Hermes records every route's rate and deposits every 10 minutes in its own Postgres (DATABASE_URL, Supabase
 * in production), so history comes from Hermes's own live reads instead of an aggregator.
 * It feeds the Safety Score's outflows and INF's APY. Without DATABASE_URL it stays off and nothing else changes.
 * Never in the quote path: rates and quotes are live reads held in memory, and history writes run in the background.
 */

export interface Snapshot {
  routeId: string;
  apy: number; // decimal
  tvlUsd: number;
  deposits?: number; // in the route's token (SOL for LSTs), so price moves don't count
  tokenValue?: number; // LSTs: SOL per token, the value APY compounds on
  withdrawable?: number; // lending: share that can be withdrawn right now
}

export interface HistoryPoint {
  at: number; // ms timestamp
  value: number;
}

const SNAPSHOT_EVERY_MS = 10 * 60 * 1000;
const KEEP_DAYS = 90;

// The connection string's own sslmode would override the options below, so it is dropped here
function connectionString(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete('sslmode');
  return parsed.toString();
}

function createPool(): Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const local = ['localhost', '127.0.0.1'].includes(new URL(url).hostname);
  const pool = new Pool({
    connectionString: connectionString(url),
    max: 3,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    // Encrypted. Supabase's pooler signs with its own CA, so the chain is not checked against Node's list.
    ssl: local ? false : { rejectUnauthorized: false },
  });
  pool.on('error', (error) => logger.warn(`History database error: ${error.message}`));
  return pool;
}

const pool = createPool();
let ready: Promise<boolean> | null = null;
let failedAt = 0;
let lastSnapshotAt = 0;
let lastPruneAt = 0;

/**
 * Create the table once. False when history is off or the database can't be reached; it retries after a minute.
 */
function ensureReady(): Promise<boolean> {
  if (!pool || Date.now() - failedAt < 60 * 1000) return Promise.resolve(false);
  if (!ready) {
    ready = pool
      .query(
        `create table if not exists rate_snapshots (
          route_id text not null,
          taken_at timestamptz not null,
          apy double precision not null,
          tvl_usd double precision not null,
          deposits double precision,
          token_value double precision,
          withdrawable double precision,
          primary key (route_id, taken_at)
        )`
      )
      .then(() => {
        logger.info('History database ready');
        return true;
      })
      .catch((error) => {
        logger.warn(`History database unavailable: ${error.message}`);
        failedAt = Date.now();
        ready = null;
        return false;
      });
  }
  return ready;
}

export function historyEnabled(): boolean {
  return pool !== null;
}

export function lastSnapshot(): string | null {
  return lastSnapshotAt ? new Date(lastSnapshotAt).toISOString() : null;
}

/**
 * Record a snapshot of every route when one is due (every 10 minutes), and prune past 90 days once a day
 */
export async function recordSnapshots(collect: () => Promise<Snapshot[]>): Promise<void> {
  if (!pool || Date.now() - lastSnapshotAt < SNAPSHOT_EVERY_MS || !(await ensureReady())) return;

  const rows = await collect();
  if (rows.length === 0) return;
  const takenAt = new Date();
  const values: unknown[] = [];
  const placeholders = rows.map((row, i) => {
    values.push(row.routeId, takenAt, row.apy, row.tvlUsd, row.deposits ?? null, row.tokenValue ?? null, row.withdrawable ?? null);
    const base = i * 7;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
  });

  try {
    await pool.query(
      `insert into rate_snapshots (route_id, taken_at, apy, tvl_usd, deposits, token_value, withdrawable)
       values ${placeholders.join(', ')} on conflict do nothing`,
      values
    );
    lastSnapshotAt = takenAt.getTime();
    logger.debug(`Recorded ${rows.length} rate snapshots`);
  } catch (error) {
    logger.warn(`Could not record rate snapshots: ${error instanceof Error ? error.message : error}`);
    return;
  }

  if (Date.now() - lastPruneAt > 24 * 60 * 60 * 1000) {
    lastPruneAt = Date.now();
    await pool
      .query(`delete from rate_snapshots where taken_at < now() - make_interval(days => $1)`, [KEEP_DAYS])
      .catch((error) => logger.warn(`Could not prune rate snapshots: ${error.message}`));
  }
}

/**
 * A route's deposits since a time, oldest first. Null when history is off or unreachable.
 */
export async function depositHistory(routeId: string, since: Date): Promise<HistoryPoint[] | null> {
  if (!(await ensureReady())) return null;
  try {
    const result = await pool!.query(
      `select taken_at, deposits from rate_snapshots
       where route_id = $1 and taken_at >= $2 and deposits is not null order by taken_at`,
      [routeId, since]
    );
    return result.rows.map((row) => ({ at: new Date(row.taken_at).getTime(), value: Number(row.deposits) }));
  } catch (error) {
    logger.warn(`Could not read deposit history for ${routeId}: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/**
 * The route's token value from the snapshot closest to `target`, no newer than `newest`. Null when there is none.
 */
export async function tokenValueNear(routeId: string, target: Date, newest: Date): Promise<HistoryPoint | null> {
  if (!(await ensureReady())) return null;
  try {
    const result = await pool!.query(
      `select taken_at, token_value from rate_snapshots
       where route_id = $1 and token_value is not null and taken_at <= $3
       order by abs(extract(epoch from taken_at - $2)) limit 1`,
      [routeId, target, newest]
    );
    const row = result.rows[0];
    return row ? { at: new Date(row.taken_at).getTime(), value: Number(row.token_value) } : null;
  } catch (error) {
    logger.warn(`Could not read token value history for ${routeId}: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}
