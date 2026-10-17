import type { SqlMigration } from "./migration-runner.js";

export const standingsSourceEvidenceMigration: SqlMigration = {
  version: 7,
  name: "standings-uploaded-schedule-source-evidence",
  sql: `
    ALTER TABLE standings_schedule_manifests
      ADD COLUMN source_content_hash TEXT
      CHECK (source_content_hash IS NULL OR length(source_content_hash) = 64);
  `
};
