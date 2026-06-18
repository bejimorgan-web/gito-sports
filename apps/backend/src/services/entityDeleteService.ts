import crypto from "node:crypto";
import { getDatabase } from "../db/connection";
import { allowedDeletes, EntityType } from "./catalog_rules";

function now() {
  return new Date().toISOString();
}

function deleteRows(database: ReturnType<typeof getDatabase>, label: string, query: string, params: Array<string>): number {
  const result = database.prepare(query).run(...params);
  return result.changes ?? 0;
}

export function deleteEntity(entityType: EntityType, entityId: string, operatorId?: string): boolean {
  if (!allowedDeletes.has(entityType)) {
    throw new Error(`Deletion not allowed for entity type ${entityType}`);
  }

  const database = getDatabase();
  const tableByEntity: Record<EntityType, string> = {
    sport: "sports",
    country: "countries",
    competition: "competitions",
    team: "teams"
  };

  const entityExists = database
    .prepare(`SELECT 1 FROM ${tableByEntity[entityType]} WHERE id = ?`)
    .get(entityId);

  if (!entityExists) {
    return false;
  }

  const affectedRecords: Record<string, number> = {};
  database.exec("BEGIN TRANSACTION;");

  try {
    if (entityType === "sport") {
      affectedRecords.competitions_sport_id_orphaned = deleteRows(
        database,
        "competitions_sport_id_orphaned",
        "UPDATE competitions SET sport_id = NULL WHERE sport_id = ?",
        [entityId]
      );

      affectedRecords.teams_sport_id_orphaned = deleteRows(
        database,
        "teams_sport_id_orphaned",
        "UPDATE teams SET sport_id = NULL WHERE sport_id = ?",
        [entityId]
      );

      affectedRecords.scheduling_matches_sport_id_orphaned = deleteRows(
        database,
        "scheduling_matches_sport_id_orphaned",
        "UPDATE scheduling_matches SET sport_id = NULL WHERE sport_id = ?",
        [entityId]
      );

      affectedRecords.sport_countries_removed = deleteRows(
        database,
        "sport_countries",
        "DELETE FROM sport_countries WHERE sport_id = ?",
        [entityId]
      );

      affectedRecords.sport_host_links_removed = deleteRows(
        database,
        "sport_host_links",
        "DELETE FROM sport_host_links WHERE sport_id = ?",
        [entityId]
      );

      affectedRecords.sport_competition_links_removed = deleteRows(
        database,
        "sport_competition_links",
        "DELETE FROM sport_competition_links WHERE sport_id = ?",
        [entityId]
      );

      affectedRecords.sport_club_links_removed = deleteRows(
        database,
        "sport_club_links",
        "DELETE FROM sport_club_links WHERE sport_id = ?",
        [entityId]
      );

      affectedRecords.sport_national_team_links_removed = deleteRows(
        database,
        "sport_national_team_links",
        "DELETE FROM sport_national_team_links WHERE sport_id = ?",
        [entityId]
      );
    }

    if (entityType === "country") {
      affectedRecords.scheduling_matches_country_id_orphaned = deleteRows(
        database,
        "scheduling_matches_country_id_orphaned",
        "UPDATE scheduling_matches SET country_id = NULL WHERE country_id = ?",
        [entityId]
      );

      affectedRecords.competitions_country_links_nil = deleteRows(
        database,
        "competitions_country_links_nil",
        "UPDATE competitions SET country_id = NULL WHERE country_id = ?",
        [entityId]
      );

      affectedRecords.teams_country_links_nil = deleteRows(
        database,
        "teams_country_links_nil",
        "UPDATE teams SET country_id = NULL WHERE country_id = ?",
        [entityId]
      );

      affectedRecords.sport_countries_removed = deleteRows(
        database,
        "sport_countries",
        "DELETE FROM sport_countries WHERE country_id = ?",
        [entityId]
      );

      affectedRecords.sport_host_links_removed = deleteRows(
        database,
        "sport_host_links",
        "DELETE FROM sport_host_links WHERE host_id = ?",
        [entityId]
      );

      affectedRecords.host_competition_links_removed = deleteRows(
        database,
        "host_competition_links",
        "DELETE FROM host_competition_links WHERE host_id = ?",
        [entityId]
      );
    }

    if (entityType === "competition") {
      affectedRecords.match_streams_removed = deleteRows(
        database,
        "match_streams",
        "DELETE FROM match_streams WHERE match_id IN (SELECT id FROM scheduling_matches WHERE competition_id = ?)",
        [entityId]
      );

      affectedRecords.scheduling_matches_removed = deleteRows(
        database,
        "scheduling_matches",
        "DELETE FROM scheduling_matches WHERE competition_id = ?",
        [entityId]
      );

      affectedRecords.streams_removed = deleteRows(
        database,
        "streams",
        "DELETE FROM streams WHERE match_id IN (SELECT id FROM matches WHERE competition_id = ?)",
        [entityId]
      );

      affectedRecords.matches_removed = deleteRows(
        database,
        "matches",
        "DELETE FROM matches WHERE competition_id = ?",
        [entityId]
      );

      affectedRecords.competition_teams_removed = deleteRows(
        database,
        "competition_teams",
        "DELETE FROM competition_teams WHERE competition_id = ?",
        [entityId]
      );

      affectedRecords.competition_club_links_removed = deleteRows(
        database,
        "competition_club_links",
        "DELETE FROM competition_club_links WHERE competition_id = ?",
        [entityId]
      );

      affectedRecords.competition_national_team_links_removed = deleteRows(
        database,
        "competition_national_team_links",
        "DELETE FROM competition_national_team_links WHERE competition_id = ?",
        [entityId]
      );

      affectedRecords.host_competition_links_removed = deleteRows(
        database,
        "host_competition_links",
        "DELETE FROM host_competition_links WHERE competition_id = ?",
        [entityId]
      );

      affectedRecords.sport_competition_links_removed = deleteRows(
        database,
        "sport_competition_links",
        "DELETE FROM sport_competition_links WHERE competition_id = ?",
        [entityId]
      );
    }

    if (entityType === "team") {
      affectedRecords.match_streams_removed = deleteRows(
        database,
        "match_streams",
        "DELETE FROM match_streams WHERE match_id IN (SELECT id FROM scheduling_matches WHERE home_team_id = ? OR away_team_id = ?)",
        [entityId, entityId]
      );

      affectedRecords.scheduling_matches_removed = deleteRows(
        database,
        "scheduling_matches",
        "DELETE FROM scheduling_matches WHERE home_team_id = ? OR away_team_id = ?",
        [entityId, entityId]
      );

      affectedRecords.streams_removed = deleteRows(
        database,
        "streams",
        "DELETE FROM streams WHERE match_id IN (SELECT id FROM matches WHERE home_team_id = ? OR away_team_id = ?)",
        [entityId, entityId]
      );

      affectedRecords.matches_removed = deleteRows(
        database,
        "matches",
        "DELETE FROM matches WHERE home_team_id = ? OR away_team_id = ?",
        [entityId, entityId]
      );

      affectedRecords.competition_teams_removed = deleteRows(
        database,
        "competition_teams",
        "DELETE FROM competition_teams WHERE team_id = ?",
        [entityId]
      );

      affectedRecords.sport_club_links_removed = deleteRows(
        database,
        "sport_club_links",
        "DELETE FROM sport_club_links WHERE club_id = ?",
        [entityId]
      );

      affectedRecords.sport_national_team_links_removed = deleteRows(
        database,
        "sport_national_team_links",
        "DELETE FROM sport_national_team_links WHERE national_team_id = ?",
        [entityId]
      );

      affectedRecords.competition_club_links_removed = deleteRows(
        database,
        "competition_club_links",
        "DELETE FROM competition_club_links WHERE club_id = ?",
        [entityId]
      );

      affectedRecords.competition_national_team_links_removed = deleteRows(
        database,
        "competition_national_team_links",
        "DELETE FROM competition_national_team_links WHERE national_team_id = ?",
        [entityId]
      );
    }

    const deletionResult = database
      .prepare(`DELETE FROM ${tableByEntity[entityType]} WHERE id = ?`)
      .run(entityId);

    affectedRecords[`${entityType}_deleted`] = deletionResult.changes ?? 0;

    database
      .prepare(
        `INSERT INTO entity_deletion_log (id, entity_type, entity_id, affected_records, operator_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        entityType,
        entityId,
        JSON.stringify(affectedRecords),
        operatorId ?? "system",
        now()
      );

    database.exec("COMMIT;");

    return deletionResult.changes > 0;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}
