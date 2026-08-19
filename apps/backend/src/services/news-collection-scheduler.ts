import type { DatabaseSync } from "../db/sqlite.js";
import type { NewsService } from "./news-service.js";

export interface NewsSourceCollectionState {
  id: string;
  enabled: boolean;
  collectionIntervalMinutes?: number | null;
  lastCollectionAttemptAt?: string | null;
  lastCollectionSucceededAt?: string | null;
  lastCollectionStatus?: string | null;
  lastCollectionError?: string | null;
  lastCollectionDiscoveredCount?: number | null;
  lastCollectionNewCount?: number | null;
  lastCollectionDuplicateCount?: number | null;
}

export class NewsCollectionScheduler {
  private initialized = false;

  constructor(
    private readonly service: NewsService,
    private readonly db: DatabaseSync
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS news_collection_locks (
        source_id TEXT PRIMARY KEY,
        lock_until INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  async runDueCollections(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const sources = this.listEligibleSources();
    for (const source of sources) {
      try {
        await this.collectSourceIfDue(source);
      } catch (error) {
        console.error(`[news-scheduler] collection failed for ${source.id}`, error);
      }
    }
  }

  private async collectSourceIfDue(source: NewsSourceCollectionState): Promise<void> {
    if (!source.enabled) {
      return;
    }

    const now = Date.now();
    const lastAttemptAt = source.lastCollectionAttemptAt ? Date.parse(source.lastCollectionAttemptAt) : NaN;
    const intervalMinutes = source.collectionIntervalMinutes ?? 60;
    const dueAfterMs = intervalMinutes * 60 * 1000;
    if (Number.isFinite(lastAttemptAt) && now - lastAttemptAt < dueAfterMs) {
      return;
    }

    if (!this.sourceExists(source.id)) {
      return;
    }

    const acquisition = this.acquireLock(source.id);
    if (!acquisition) {
      return;
    }

    try {
      this.markAttemptStarted(source.id);
      const result = await this.service.collectSource({ sourceId: source.id });
      this.markAttemptCompleted(source.id, "success", null, result.discovered, result.imported, result.skipped);
    } catch (error) {
      if (error instanceof Error && error.message === "source_not_available") {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.markAttemptCompleted(source.id, "error", message, 0, 0, 0);
    } finally {
      this.releaseLock(source.id);
    }
  }

  private sourceExists(sourceId: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM news_sources WHERE id = ? LIMIT 1").get(sourceId) as { '1'?: number } | undefined;
    return Boolean(row);
  }

  private acquireLock(sourceId: string): boolean {
    const now = Date.now();
    const row = this.db.prepare("SELECT lock_until FROM news_collection_locks WHERE source_id = ?").get(sourceId) as { lock_until?: number } | undefined;
    if (row && Number(row.lock_until ?? 0) > now) {
      return false;
    }

    this.db.prepare("INSERT INTO news_collection_locks (source_id, lock_until, updated_at) VALUES (?, ?, ?) ON CONFLICT(source_id) DO UPDATE SET lock_until = excluded.lock_until, updated_at = excluded.updated_at")
      .run(sourceId, now + 30_000, new Date().toISOString());
    return true;
  }

  private releaseLock(sourceId: string): void {
    this.db.prepare("UPDATE news_collection_locks SET lock_until = 0 WHERE source_id = ?").run(sourceId);
  }

  private markAttemptStarted(sourceId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE news_sources
      SET last_collection_attempt_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, sourceId);
  }

  private markAttemptCompleted(sourceId: string, status: string, error: string | null, discoveredCount: number, newCount: number, duplicateCount: number): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE news_sources
      SET last_collection_attempt_at = ?,
          last_collection_succeeded_at = CASE WHEN ? = 'success' THEN ? ELSE last_collection_succeeded_at END,
          last_collection_status = ?,
          last_collection_error = ?,
          last_collection_discovered_count = ?,
          last_collection_new_count = ?,
          last_collection_duplicate_count = ?,
          updated_at = ?
      WHERE id = ?
    `).run(now, status, now, status, error ?? null, discoveredCount, newCount, duplicateCount, now, sourceId);
  }

  private listEligibleSources(): NewsSourceCollectionState[] {
    return this.db.prepare(`
      SELECT id,
             enabled,
             collection_interval_minutes AS collectionIntervalMinutes,
             last_collection_attempt_at AS lastCollectionAttemptAt,
             last_collection_succeeded_at AS lastCollectionSucceededAt,
             last_collection_status AS lastCollectionStatus,
             last_collection_error AS lastCollectionError,
             last_collection_discovered_count AS lastCollectionDiscoveredCount,
             last_collection_new_count AS lastCollectionNewCount,
             last_collection_duplicate_count AS lastCollectionDuplicateCount
      FROM news_sources
      WHERE enabled = 1
      ORDER BY name ASC
    `).all() as NewsSourceCollectionState[];
  }

}
