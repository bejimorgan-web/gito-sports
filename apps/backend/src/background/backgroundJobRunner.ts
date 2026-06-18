import { getDatabase } from "../db/connection.js";

type JobFn = () => Promise<void> | void;

// Ensure lock table exists
function ensureLockTable() {
  const db = getDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS job_locks (name TEXT PRIMARY KEY, last_run_at TEXT, lock_until INTEGER);`);
}

function tryAcquireLock(name: string, leaseMs: number): boolean {
  const db = getDatabase();
  const now = Date.now();

  // Use a transaction to perform check-and-set atomically.
  try {
    db.exec("BEGIN IMMEDIATE;");
    const row = db.prepare("SELECT lock_until FROM job_locks WHERE name = ?").get(name) as { lock_until?: number } | undefined;
    if (row && row.lock_until && row.lock_until > now) {
      db.exec("COMMIT;");
      return false;
    }

    const lockUntil = now + leaseMs;
    db.prepare("INSERT OR REPLACE INTO job_locks (name, last_run_at, lock_until) VALUES (?, ?, ?)").run(name, new Date().toISOString(), lockUntil);
    db.exec("COMMIT;");
    return true;
  } catch (err) {
    try { db.exec("ROLLBACK;"); } catch {};
    return false;
  }
}

function releaseLock(name: string) {
  const db = getDatabase();
  db.prepare("UPDATE job_locks SET lock_until = 0 WHERE name = ?").run(name);
}

export function scheduleBackgroundJob(name: string, intervalMs: number, jobFn: JobFn) {
  ensureLockTable();

  async function tick() {
    try {
      const acquired = tryAcquireLock(name, Math.max(5_000, Math.floor(intervalMs / 2)));
      if (!acquired) return;

      // Run job but do not allow unhandled rejection to crash
      try {
        await Promise.resolve(jobFn());
      } catch (jobErr) {
        console.error(`[background] job ${name} failed`, jobErr);
      } finally {
        try { releaseLock(name); } catch (e) { console.error(`[background] failed to release lock ${name}`, e); }
      }
    } catch (err) {
      console.error(`[background] scheduler error for ${name}`, err);
    }
  }

  // immediately schedule first tick and then interval
  setImmediate(() => void tick());
  setInterval(() => void tick(), intervalMs);
}
