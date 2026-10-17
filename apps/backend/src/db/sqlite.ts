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
  private transactionActive = false;

  constructor(path: string, options?: { readonly?: boolean }) {
    if (!allowDirectInstantiation) {
      throw new Error(
        "Direct sqlite DatabaseSync instantiation is forbidden outside apps/backend/src/db/connection.ts"
      );
    }

    const DatabaseCtor = Database as unknown as new (filePath: string, options?: { readonly?: boolean }) => Database;
    this.db = new DatabaseCtor(path, options ? { readonly: options.readonly ?? false } : undefined);
  }

  // --- OPTIONAL SAFE WRAPPERS (add what you need) ---

  prepare(sql: string) {
    return this.db.prepare(sql);
  }

  exec(sql: string) {
    const result = this.db.exec(sql);
    if (/^\s*BEGIN\b/i.test(sql)) this.transactionActive = true;
    if (/^\s*(COMMIT|ROLLBACK)\b/i.test(sql)) this.transactionActive = false;
    return result;
  }

  get inTransaction(): boolean {
    return this.transactionActive;
  }

  transaction<T extends (...args: any[]) => any>(fn: T) {
    return this.db.transaction(fn as any);
  }

  close() {
    return this.db.close();
  }
}