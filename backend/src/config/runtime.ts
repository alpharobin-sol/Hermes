/**
 * Runtime switches
 */

// Background workers (yield collector, DPO, signal monitor) need Postgres and Redis.
// Set ENABLE_WORKERS=false to run the API on its own, e.g. on a host without those services.
export function workersEnabled(): boolean {
  return process.env.ENABLE_WORKERS !== 'false';
}
