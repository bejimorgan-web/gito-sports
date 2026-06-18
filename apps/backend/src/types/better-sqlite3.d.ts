declare module "better-sqlite3" {
  interface Statement {
    run(...params: any[]): RunResult;
    get(...params: any[]): any;
    all(...params: any[]): any[];
  }

  interface RunResult {
    changes: number;
    lastInsertRowid: number;
  }

  class Database {
    constructor(filename: string);
    prepare(sql: string): Statement;
    exec(sql: string): void;
    transaction<T extends (...args: any[]) => any>(fn: T): T;
    close(): void;
  }

  export default Database;
}
