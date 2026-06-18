import Database from "better-sqlite3";

let allowDirectInstantiation = false;

/**
 * Safe wrapper that controls DB instantiation
 * so only connection.ts can create the database.
 */
export function allowSqliteInstantiation<T>(callback: () => T): T {
  allowDirectInstantiation = true;

  try {
    return callback();
  } finally {
    allowDirectInstantiation = false;
  }
}

/**
 * Wrapped SQLite database using better-sqlite3
 */
export class DatabaseSync {
  private db: Database;

  constructor(path: string) {
    if (!allowDirectInstantiation) {
      throw new Error(
        "Direct sqlite DatabaseSync instantiation is forbidden outside apps/backend/src/db/connection.ts"
      );
    }

    this.db = new Database(path);
  }

  // --- OPTIONAL SAFE WRAPPERS (add what you need) ---

  prepare(sql: string) {
    return this.db.prepare(sql);
  }

  exec(sql: string) {
    return this.db.exec(sql);
  }

  transaction<T extends (...args: any[]) => any>(fn: T) {
    return this.db.transaction(fn as any);
  }

  close() {
    return this.db.close();
  }
}