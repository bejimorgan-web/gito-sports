declare module "better-sqlite3" {
  class Database {
    constructor(filename: string);
    pragma(statement: string): unknown;
    exec(statement: string): void;
    prepare(statement: string): {
      run(...parameters: unknown[]): { changes: number };
      get(...parameters: unknown[]): unknown;
      all(...parameters: unknown[]): unknown[];
    };
    transaction<T>(work: () => T): () => T;
    close(): void;
  }

  export default Database;
}
