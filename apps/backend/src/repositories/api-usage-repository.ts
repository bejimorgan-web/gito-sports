import { getDatabase } from "../db/connection.js";

export type ApiUsageType = "live_fixtures" | "fixtures" | "logos" | "leagues";

export type ApiUsageEntry = {
  id: string;
  request_type: ApiUsageType;
  last_request_timestamp: number; // Unix timestamp in milliseconds
  created_at: string;
  updated_at: string;
};

export const ApiUsageRepository = {
  /**
   * Get the last request timestamp for a given API request type.
   * Returns null if no prior request exists.
   */
  getLastRequestTimestamp(requestType: ApiUsageType): number | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT last_request_timestamp FROM api_usage_log
      WHERE request_type = ?
      LIMIT 1
    `).get(requestType) as { last_request_timestamp: number } | undefined;
    
    return row?.last_request_timestamp ?? null;
  },

  /**
   * Update or insert the last request timestamp for a given API request type.
   */
  updateLastRequestTimestamp(requestType: ApiUsageType, timestamp: number): void {
    const db = getDatabase();
    const now = new Date().toISOString();
    
    // Try update first
    const stmt = db.prepare(`
      UPDATE api_usage_log
      SET last_request_timestamp = ?, updated_at = ?
      WHERE request_type = ?
    `);
    
    const result = stmt.run(timestamp, now, requestType);
    
    // If no rows were updated, insert a new entry
    if ((result as any).changes === 0) {
      const id = `api_usage_${requestType}_${Date.now()}`;
      db.prepare(`
        INSERT INTO api_usage_log (id, request_type, last_request_timestamp, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, requestType, timestamp, now, now);
    }
  },

  /**
   * Clear all API usage records (for testing/reset).
   */
  clearAll(): void {
    const db = getDatabase();
    db.prepare("DELETE FROM api_usage_log").run();
  },

  /**
   * Get all API usage entries.
   */
  getAll(): ApiUsageEntry[] {
    const db = getDatabase();
    return db.prepare(`
      SELECT id, request_type, last_request_timestamp, created_at, updated_at
      FROM api_usage_log
      ORDER BY updated_at DESC
    `).all() as ApiUsageEntry[];
  }
};
