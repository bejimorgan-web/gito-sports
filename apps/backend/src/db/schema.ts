import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export const initialSchemaPath = path.join(
  currentDirectory,
  "schema",
  "initial-schema.sql"
);

export function readInitialSchema(): string {
  return fs.readFileSync(initialSchemaPath, "utf8");
}
