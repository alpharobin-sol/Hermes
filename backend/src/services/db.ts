import { Pool } from 'pg';
import { logger } from '../utils/logger';

/**
 * Hermes's own Postgres (DATABASE_URL, Supabase in production): rate history, alert subscriptions, alert log and
 * a few settings. Without DATABASE_URL everything that needs it stays off and the rest of Hermes works as before.
 */

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
  pool.on('error', (error) => logger.warn(`Database error: ${error.message}`));
  return pool;
}

export const pool = createPool();

const SCHEMA = `
  create table if not exists rate_snapshots (
    route_id text not null,
    taken_at timestamptz not null,
    apy double precision not null,
    tvl_usd double precision not null,
    deposits double precision,
    token_value double precision,
    withdrawable double precision,
    primary key (route_id, taken_at)
  );
  alter table rate_snapshots add column if not exists safety_score double precision;

  create table if not exists app_settings (
    key text primary key,
    value text not null
  );

  create table if not exists push_subscriptions (
    endpoint text primary key,
    p256dh text not null,
    auth text not null,
    routes text[] not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table if not exists alert_log (
    endpoint text not null,
    route_id text not null,
    kind text not null,
    sent_at timestamptz not null default now()
  );
  create index if not exists alert_log_recent on alert_log (endpoint, route_id, kind, sent_at desc);
`;

let ready: Promise<boolean> | null = null;
let failedAt = 0;

/**
 * Create the tables once. False when the database is off or can't be reached; it retries after a minute.
 */
export function dbReady(): Promise<boolean> {
  if (!pool || Date.now() - failedAt < 60 * 1000) return Promise.resolve(false);
  if (!ready) {
    ready = pool
      .query(SCHEMA)
      .then(() => {
        logger.info('Database ready');
        return true;
      })
      .catch((error) => {
        logger.warn(`Database unavailable: ${error.message}`);
        failedAt = Date.now();
        ready = null;
        return false;
      });
  }
  return ready;
}
