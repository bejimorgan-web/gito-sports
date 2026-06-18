import { DatabaseSync as NativeDatabaseSync } from "node:sqlite";

let allowDirectInstantiation = false;

export function allowSqliteInstantiation<T>(callback: () => T): T {
  allowDirectInstantiation = true;

  try {
    return callback();
  } finally {
    allowDirectInstantiation = false;
  }
}

export class DatabaseSync extends NativeDatabaseSync {
  constructor(path: string) {
    if (!allowDirectInstantiation) {
      throw new Error(
        "Direct sqlite DatabaseSync instantiation is forbidden outside apps/backend/src/db/connection.ts"
      );
    }

    super(path);
  }
}
