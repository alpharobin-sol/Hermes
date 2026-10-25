import { logger } from '../utils/logger';
import { dbReady, pool } from './db';

/**
 * HERMES HISTORY
 * Hermes records every route's rate and deposits every 10 minutes in its own Postgres (DATABASE_URL, Supabase
 * in production), so history comes from Hermes's own live reads instead of an aggregator.
 * It feeds the Safety Score's outflows, INF's APY and each stake pool's value by epoch (APYs over several epochs).
 * Without DATABASE_URL it stays off and nothing else changes.
 * Never in the quote path: rates and quotes are live reads held in memory, and history writes run in the background.
 */

export interface Snapshot {
  routeId: string;
  apy: number; // decimal
  tvlUsd: number;
  deposits?: number; // in the route's token (SOL for LSTs), so price moves don't count
  tokenValue?: number; // LSTs: SOL per token, the value APY compounds on
  withdrawable?: number; // lending: share that can be withdrawn right now
  safetyScore?: number; // the route's Safety Score, for alerts when it falls
}

export interface HistoryPoint {
  at: number; // ms timestamp
  value: number;
}

const SNAPSHOT_EVERY_MS = 10 * 60 * 1000;
const KEEP_DAYS = 90;

let lastSnapshotAt = 0;
let lastPruneAt = 0;

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
  if (!pool || Date.now() - lastSnapshotAt < SNAPSHOT_EVERY_MS || !(await dbReady())) return;

  const rows = await collect();
  if (rows.length === 0) return;
  const takenAt = new Date();
  const values: unknown[] = [];
  const placeholders = rows.map((row, i) => {
    values.push(
      row.routeId,
      takenAt,
      row.apy,
      row.tvlUsd,
      row.deposits ?? null,
      row.tokenValue ?? null,
      row.withdrawable ?? null,
      row.safetyScore ?? null
    );
    const base = i * 8;
    return `(${Array.from({ length: 8 }, (_, k) => `$${base + k + 1}`).join(', ')})`;
  });

  try {
    await pool.query(
      `insert into rate_snapshots (route_id, taken_at, apy, tvl_usd, deposits, token_value, withdrawable, safety_score)
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
  if (!(await dbReady())) return null;
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
  if (!(await dbReady())) return null;
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

export interface EpochValue {
  pool: string; // stake pool address
  epoch: number;
  value: number; // SOL per token after that epoch's update
}

/**
 * Record stake pools' SOL per token by epoch. A value already recorded for an epoch stays.
 */
export async function recordEpochValues(rows: EpochValue[]): Promise<boolean> {
  if (rows.length === 0 || !(await dbReady())) return false;
  const values: unknown[] = [];
  const placeholders = rows.map((row, i) => {
    values.push(row.pool, row.epoch, row.value);
    return `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`;
  });
  try {
    await pool!.query(
      `insert into stake_pool_epochs (pool, epoch, token_value) values ${placeholders.join(', ')} on conflict do nothing`,
      values
    );
    return true;
  } catch (error) {
    logger.warn(`Could not record stake pool epochs: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

/**
 * Each stake pool's SOL per token for the last `epochs` epochs Hermes recorded, by pool then epoch. Null when history
 * is off or unreachable.
 */
export async function recentEpochValues(epochs: number): Promise<Map<string, Map<number, number>> | null> {
  if (!(await dbReady())) return null;
  try {
    const result = await pool!.query(
      `select pool, epoch, token_value from stake_pool_epochs
       where epoch >= (select max(epoch) from stake_pool_epochs) - $1`,
      [epochs]
    );
    const byPool = new Map<string, Map<number, number>>();
    for (const row of result.rows) {
      if (!byPool.has(row.pool)) byPool.set(row.pool, new Map());
      byPool.get(row.pool)!.set(Number(row.epoch), Number(row.token_value));
    }
    return byPool;
  } catch (error) {
    logger.warn(`Could not read stake pool epochs: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

export interface PastReading {
  at: number; // ms timestamp
  apy: number;
  safetyScore: number | null;
  deposits: number | null; // in the route's token
}

/**
 * The route's reading from the snapshot closest to `target`, within 3 hours of it. Null when there is none.
 */
export async function readingNear(routeId: string, target: Date): Promise<PastReading | null> {
  if (!(await dbReady())) return null;
  try {
    const result = await pool!.query(
      `select taken_at, apy, safety_score, deposits from rate_snapshots
       where route_id = $1 and taken_at between $2::timestamptz - interval '3 hours' and $2::timestamptz + interval '3 hours'
       order by abs(extract(epoch from taken_at - $2::timestamptz)) limit 1`,
      [routeId, target]
    );
    const row = result.rows[0];
    return row
      ? {
          at: new Date(row.taken_at).getTime(),
          apy: Number(row.apy),
          safetyScore: row.safety_score === null ? null : Number(row.safety_score),
          deposits: row.deposits === null ? null : Number(row.deposits),
        }
      : null;
  } catch (error) {
    logger.warn(`Could not read history for ${routeId}: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}
