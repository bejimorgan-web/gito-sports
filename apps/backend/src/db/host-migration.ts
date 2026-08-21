import crypto from "node:crypto";

import type { DatabaseSync } from "./sqlite.js";

export function migrateLegacyCompetitionHosts(database: DatabaseSync): number {
  const now = new Date().toISOString();
  const legacyRows = database.prepare(
    `SELECT c.id AS competition_id, c.sport_id, c.country_id, co.name
     FROM competitions c
     JOIN countries co ON co.id = c.country_id
     WHERE c.host_id IS NULL AND c.sport_id IS NOT NULL`
  ).all() as Array<{ competition_id: string; sport_id: string; country_id: string; name: string }>;

  const findHost = database.prepare("SELECT id FROM hosts WHERE sport_id = ? AND country_id = ? AND host_type = 'country'");
  const insertHost = database.prepare(
    "INSERT INTO hosts (id, sport_id, name, host_type, country_id, status, created_at, updated_at) VALUES (?, ?, ?, 'country', ?, 'active', ?, ?)"
  );
  const updateCompetition = database.prepare("UPDATE competitions SET host_id = ? WHERE id = ? AND host_id IS NULL");
  let migrated = 0;

  for (const row of legacyRows) {
    let host = findHost.get(row.sport_id, row.country_id) as { id: string } | undefined;
    if (!host) {
      host = { id: crypto.randomUUID() };
      insertHost.run(host.id, row.sport_id, row.name, row.country_id, now, now);
    }
    migrated += updateCompetition.run(host.id, row.competition_id).changes;
  }

  return migrated;
}
