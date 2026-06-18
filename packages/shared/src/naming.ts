export type EntityId = string;

export type EntityStatus = "active" | "inactive" | "archived" | "stale";

export function createSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

