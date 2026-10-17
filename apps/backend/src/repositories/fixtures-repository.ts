import crypto from "node:crypto";
import { getDatabase } from "../db/connection.js";

export interface CanonicalFixtureInput {
  competitionId: string;
  seasonId?: string | null;
  homeTeamId: string;
  awayTeamId: string;
  startsAt: string;
  venueName?: string | null;
  venueImageUrl?: string | null;
  status?: string;
  externalProvider?: string | null;
  externalMatchId?: string | null;
}

export interface CanonicalFixtureImportRow {
  fixtureId?: string;
  homeTeamName?: string;
  awayTeamName?: string;
  startsAt?: string;
  venueName?: string;
  homeScore?: number;
  awayScore?: number;
  resultCorrectionReason?: string;
}

function validateFixtureInput(input: CanonicalFixtureInput) {
  const db = getDatabase();
  if (input.homeTeamId === input.awayTeamId) throw new Error("home_and_away_must_differ");
  const competition = db.prepare("SELECT id, sport_id FROM competitions WHERE id = ?").get(input.competitionId) as { id: string; sport_id: string | null } | undefined;
  if (!competition) throw new Error("competition_not_found");
  const teams = db.prepare("SELECT id, sport_id FROM teams WHERE id IN (?, ?)").all(input.homeTeamId, input.awayTeamId) as Array<{ id: string; sport_id: string | null }>;
  if (teams.length !== 2) throw new Error("team_not_found");
  if (competition.sport_id && teams.some((team) => team.sport_id !== competition.sport_id)) throw new Error("fixture_sport_mismatch");
  if (input.seasonId) {
    const season = db.prepare("SELECT id, competition_id FROM seasons WHERE id = ?").get(input.seasonId) as { id: string; competition_id: string } | undefined;
    if (!season) throw new Error("season_not_found");
    if (season.competition_id !== input.competitionId) throw new Error("competition_season_mismatch");
    const membershipCount = db.prepare("SELECT COUNT(*) AS count FROM competition_season_teams WHERE competition_id = ? AND season_id = ? AND team_id IN (?, ?)").get(input.competitionId, input.seasonId, input.homeTeamId, input.awayTeamId) as { count: number };
    if (Number(membershipCount.count) !== 2) throw new Error("season_team_membership_required");
  }
  if (!input.startsAt) throw Object.assign(new Error("A match date is required."), { code: "invalid_starts_at" });
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(input.startsAt);
  const hasExplicitTimeZone = /T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(input.startsAt);
  const isValidCalendarDate = dateOnly && !Number.isNaN(Date.parse(`${input.startsAt}T00:00:00.000Z`)) && new Date(`${input.startsAt}T00:00:00.000Z`).toISOString().slice(0, 10) === input.startsAt;
  if ((!dateOnly && !hasExplicitTimeZone) || (dateOnly && !isValidCalendarDate) || Number.isNaN(Date.parse(input.startsAt))) {
    throw Object.assign(new Error("Enter a valid match date and, when available, a kickoff time with an explicit timezone."), { code: "invalid_starts_at" });
  }
}

export function findEquivalentCanonicalFixtures(input: CanonicalFixtureInput) {
  validateFixtureInput(input);
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM matches WHERE competition_id = ? AND home_team_id = ? AND away_team_id = ? ORDER BY starts_at ASC").all(input.competitionId, input.homeTeamId, input.awayTeamId) as any[];
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  return rows.filter((row) => {
    if (dateOnly.test(input.startsAt) || dateOnly.test(String(row.starts_at))) {
      return String(row.starts_at).slice(0, 10) === input.startsAt.slice(0, 10);
    }
    return Math.abs(Date.parse(String(row.starts_at)) - Date.parse(input.startsAt)) <= 2 * 60 * 60 * 1000;
  });
}

export function createCanonicalFixture(input: CanonicalFixtureInput) {
  validateFixtureInput(input);
  const db = getDatabase();
  if (input.externalProvider && input.externalMatchId) {
    const external = db.prepare("SELECT id FROM matches WHERE external_provider = ? AND external_match_id = ?").get(input.externalProvider, input.externalMatchId);
    if (external) throw new Error("canonical_fixture_external_duplicate");
  }
  const equivalent = findEquivalentCanonicalFixtures(input);
  if (equivalent.length > 0) throw new Error("canonical_fixture_duplicate");
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  db.prepare("INSERT INTO matches (id, competition_id, season_id, home_team_id, away_team_id, starts_at, venue_name, venue_image_url, external_provider, external_match_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, input.competitionId, input.seasonId ?? null, input.homeTeamId, input.awayTeamId, input.startsAt, input.venueName ?? null, input.venueImageUrl ?? null, input.externalProvider ?? null, input.externalMatchId ?? null, input.status ?? "scheduled", timestamp, timestamp);
  return getCanonicalFixtureById(id);
}

/** Update exported fixtures in place and append new rows; omitted fixtures are preserved. */
export function importCanonicalFixtures(input: { hostId: string; competitionId: string; seasonId: string; rows: CanonicalFixtureImportRow[] }) {
  const db = getDatabase();
  if (!Array.isArray(input.rows) || input.rows.length > 2000) throw new Error("invalid_fixture_import_rows");
  const competition = db.prepare("SELECT id, host_id, sport_id, participant_type FROM competitions WHERE id = ?").get(input.competitionId) as { id: string; host_id: string | null; sport_id: string; participant_type: string } | undefined;
  if (!competition) throw new Error("competition_not_found");
  if (competition.host_id !== input.hostId) throw new Error("fixture_host_competition_mismatch");
  const season = db.prepare("SELECT id, competition_id FROM seasons WHERE id = ?").get(input.seasonId) as { id: string; competition_id: string } | undefined;
  if (!season) throw new Error("season_not_found");
  if (season.competition_id !== input.competitionId) throw new Error("competition_season_mismatch");
  const expectedType = competition.participant_type === "nationalTeams" ? "national" : competition.participant_type === "clubs" ? "club" : undefined;
  const skippedIds = new Set<string>();
  const created: any[] = [];
  const updated: any[] = [];
  const rowResults: Array<{ rowIndex: number; fixtureId: string; action: "created" | "updated" | "unchanged" }> = [];
  const seen = new Set<string>();
  const resolvedFixtureIds = new Set<string>();
  const resolveTeam = (nameValue: string | undefined) => {
    const name = String(nameValue ?? "").trim();
    if (!name) throw new Error("fixture_team_name_required");
    const team = db.prepare("SELECT t.id, t.type, t.home_stadium_name, t.home_stadium_photo_url FROM teams t JOIN competition_season_teams cst ON cst.team_id = t.id WHERE t.host_id = ? AND t.sport_id = ? AND cst.competition_id = ? AND cst.season_id = ? AND lower(trim(t.name)) = lower(trim(?)) LIMIT 1")
      .get(input.hostId, competition.sport_id, input.competitionId, input.seasonId, name) as { id: string; type: string; home_stadium_name: string | null; home_stadium_photo_url: string | null } | undefined;
    if (!team) throw new Error(`fixture_team_not_in_season:${name}`);
    if (expectedType && team.type !== expectedType) throw new Error("team_participant_type_mismatch");
    return team;
  };

  const run = db.transaction(() => {
    input.rows.forEach((row, rowIndex) => {
      if (row.fixtureId?.trim()) {
        const existing = db.prepare("SELECT id, competition_id, season_id, home_team_id, away_team_id FROM matches WHERE id = ?").get(row.fixtureId.trim()) as { id: string; competition_id: string; season_id: string | null; home_team_id: string; away_team_id: string } | undefined;
        if (!existing || existing.competition_id !== input.competitionId || existing.season_id !== input.seasonId) throw new Error("fixture_import_id_mismatch");
        if (resolvedFixtureIds.has(existing.id)) throw new Error("duplicate_fixture_import_row");
        if (!row.startsAt?.trim()) throw new Error("A match date is required.");
        const homeTeam = resolveTeam(row.homeTeamName);
        const awayTeam = resolveTeam(row.awayTeamName);
        const currentScore = db.prepare(`SELECT CASE WHEN EXISTS (
            SELECT 1 FROM match_score_state WHERE match_id = ? AND final_result_confirmed = 1
          ) OR EXISTS (
            SELECT 1 FROM match_result_revisions WHERE match_id = ? AND result_status = 'ended'
              AND final_result_confirmed = 1 AND validation_state = 'accepted'
          ) THEN 1 ELSE 0 END AS final_result_confirmed`).get(existing.id, existing.id) as { final_result_confirmed: number };
        if (Number(currentScore?.final_result_confirmed) === 1 && (existing.home_team_id !== homeTeam.id || existing.away_team_id !== awayTeam.id)) throw new Error("fixture_import_confirmed_result_participants_locked");
        const current = getCanonicalFixtureById(existing.id);
        const sameStart = current?.startsAt && Date.parse(current.startsAt) === Date.parse(row.startsAt.trim());
        if (Number(currentScore?.final_result_confirmed) === 1 && !sameStart) throw new Error("fixture_import_confirmed_result_schedule_locked");
        if (!sameStart || existing.home_team_id !== homeTeam.id || existing.away_team_id !== awayTeam.id) {
          const fixture = updateCanonicalFixture(existing.id, { startsAt: row.startsAt.trim(), homeTeamId: homeTeam.id, awayTeamId: awayTeam.id, venueName: homeTeam.home_stadium_name, venueImageUrl: homeTeam.home_stadium_photo_url });
          if (!fixture) throw new Error("fixture_not_found");
          updated.push(fixture);
          rowResults.push({ rowIndex, fixtureId: fixture.id, action: "updated" });
        } else {
          skippedIds.add(existing.id);
          rowResults.push({ rowIndex, fixtureId: existing.id, action: "unchanged" });
        }
        resolvedFixtureIds.add(existing.id);
        return;
      }
      const homeTeam = resolveTeam(row.homeTeamName);
      const awayTeam = resolveTeam(row.awayTeamName);
      const signature = `${homeTeam.id}:${awayTeam.id}:${String(row.startsAt ?? "").trim()}`.toLocaleLowerCase();
      if (seen.has(signature)) throw new Error("duplicate_fixture_import_row");
      seen.add(signature);
      const fixtureInput: CanonicalFixtureInput = {
        competitionId: input.competitionId,
        seasonId: input.seasonId,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        startsAt: String(row.startsAt ?? "").trim(),
        venueName: homeTeam.home_stadium_name,
        venueImageUrl: homeTeam.home_stadium_photo_url,
        status: "scheduled"
      };
      const equivalent = findEquivalentCanonicalFixtures(fixtureInput);
      if (equivalent.length) {
        if (resolvedFixtureIds.has(equivalent[0].id)) throw new Error("duplicate_fixture_import_row");
        skippedIds.add(`${homeTeam.id}:${awayTeam.id}:${fixtureInput.startsAt}`);
        rowResults.push({ rowIndex, fixtureId: equivalent[0].id, action: "unchanged" });
        resolvedFixtureIds.add(equivalent[0].id);
        return;
      }
      const fixture = createCanonicalFixture(fixtureInput);
      if (!fixture) throw new Error("fixture_create_failed");
      created.push(fixture);
      rowResults.push({ rowIndex, fixtureId: fixture.id, action: "created" });
      resolvedFixtureIds.add(fixture.id);
    });
  });
  run();
  return { created, updated, rowResults, createdCount: created.length, updatedCount: updated.length, skippedCount: skippedIds.size };
}

export function updateCanonicalFixture(fixtureId: string, input: Partial<CanonicalFixtureInput>) {
  const existing = getDatabase().prepare("SELECT * FROM matches WHERE id = ?").get(fixtureId) as any;
  if (!existing) return undefined;
  const next = { competitionId: input.competitionId ?? existing.competition_id, seasonId: input.seasonId !== undefined ? input.seasonId : existing.season_id, homeTeamId: input.homeTeamId ?? existing.home_team_id, awayTeamId: input.awayTeamId ?? existing.away_team_id, startsAt: input.startsAt ?? existing.starts_at, venueName: input.venueName !== undefined ? input.venueName : existing.venue_name, venueImageUrl: input.venueImageUrl !== undefined ? input.venueImageUrl : existing.venue_image_url, status: input.status ?? existing.status, externalProvider: input.externalProvider !== undefined ? input.externalProvider : existing.external_provider, externalMatchId: input.externalMatchId !== undefined ? input.externalMatchId : existing.external_match_id };
  validateFixtureInput(next);
  getDatabase().prepare("UPDATE matches SET competition_id = ?, season_id = ?, home_team_id = ?, away_team_id = ?, starts_at = ?, venue_name = ?, venue_image_url = ?, external_provider = ?, external_match_id = ?, status = ?, updated_at = ? WHERE id = ?").run(next.competitionId, next.seasonId ?? null, next.homeTeamId, next.awayTeamId, next.startsAt, next.venueName ?? null, next.venueImageUrl ?? null, next.externalProvider ?? null, next.externalMatchId ?? null, next.status, new Date().toISOString(), fixtureId);
  return getCanonicalFixtureById(fixtureId);
}

export function listCanonicalFixturesForTeam(teamId: string, options?: { seasonId?: string; competitionId?: string }) {
  const conditions = ["(m.home_team_id = ? OR m.away_team_id = ?)"];
  const params: string[] = [teamId, teamId];
  if (options?.seasonId) { conditions.push("m.season_id = ?"); params.push(options.seasonId); }
  if (options?.competitionId) { conditions.push("m.competition_id = ?"); params.push(options.competitionId); }
  const rows = getDatabase().prepare(`SELECT m.id FROM matches m WHERE ${conditions.join(" AND ")} ORDER BY m.starts_at ASC`).all(...params) as Array<{ id: string }>;
  return rows.map((row) => getCanonicalFixtureById(row.id)).filter(Boolean);
}

export function getCanonicalFixtureById(fixtureId: string) {
  const row = getDatabase().prepare(`
    SELECT m.id, m.competition_id, m.season_id, m.home_team_id, m.away_team_id,
           m.starts_at, m.venue_name, m.venue_image_url, m.status, m.external_provider, m.external_match_id,
           m.created_at, m.updated_at,
           h.name AS home_team_name, h.short_name AS home_team_short_name, h.logo_url AS home_team_logo_url, h.host_id AS home_team_host_id,
           h.home_stadium_name AS home_team_stadium_name, h.home_stadium_photo_url AS home_team_stadium_photo_url,
           a.name AS away_team_name, a.short_name AS away_team_short_name, a.logo_url AS away_team_logo_url, a.host_id AS away_team_host_id,
           c.name AS competition_name, c.slug AS competition_slug, c.logo_url AS competition_logo_url, c.host_id AS competition_host_id,
           host.name AS host_name,
           s.name AS season_name,
           sp.id AS sport_id, sp.name AS sport_name,
           co.id AS country_id, co.name AS country_name
    FROM matches m
    JOIN teams h ON h.id = m.home_team_id
    JOIN teams a ON a.id = m.away_team_id
    JOIN competitions c ON c.id = m.competition_id
    LEFT JOIN hosts host ON host.id = c.host_id
    LEFT JOIN seasons s ON s.id = m.season_id
    LEFT JOIN sports sp ON sp.id = c.sport_id
    LEFT JOIN countries co ON co.id = c.country_id
    WHERE m.id = ?
  `).get(fixtureId) as any;

  if (!row) return undefined;
  return {
    id: row.id,
    competitionId: row.competition_id,
    seasonId: row.season_id ?? null,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
    startsAt: row.starts_at,
    venueName: row.venue_name ?? null,
    venueImageUrl: row.venue_image_url ?? null,
    status: row.status,
    externalProvider: row.external_provider ?? null,
    externalMatchId: row.external_match_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sport: row.sport_id ? { id: row.sport_id, name: row.sport_name } : null,
    country: row.country_id ? { id: row.country_id, name: row.country_name } : null,
    host: row.competition_host_id ? { id: row.competition_host_id, name: row.host_name } : null,
    competition: { id: row.competition_id, name: row.competition_name, slug: row.competition_slug, logoUrl: row.competition_logo_url ?? null },
    season: row.season_id ? { id: row.season_id, name: row.season_name } : null,
    homeTeam: { id: row.home_team_id, name: row.home_team_name, shortName: row.home_team_short_name, logoUrl: row.home_team_logo_url, homeStadiumName: row.home_team_stadium_name ?? null, homeStadiumPhotoUrl: row.home_team_stadium_photo_url ?? null, ...(row.home_team_host_id ? { hostId: row.home_team_host_id } : {}) },
    awayTeam: { id: row.away_team_id, name: row.away_team_name, shortName: row.away_team_short_name, logoUrl: row.away_team_logo_url, ...(row.away_team_host_id ? { hostId: row.away_team_host_id } : {}) }
  };
}

export function listCanonicalFixtures(filters?: { sportId?: string; sportIds?: string[]; competitionId?: string; competitionIds?: string[]; seasonId?: string; teamId?: string; teamIds?: string[]; status?: string; from?: string; to?: string; limit?: number; offset?: number }) {
  const conditions: string[] = [];
  const parameters: string[] = [];
  const sportIds = [...new Set([...(filters?.sportIds ?? []), ...(filters?.sportId ? [filters.sportId] : [])])];
  const competitionIds = [...new Set([...(filters?.competitionIds ?? []), ...(filters?.competitionId ? [filters.competitionId] : [])])];
  const teamIds = [...new Set([...(filters?.teamIds ?? []), ...(filters?.teamId ? [filters.teamId] : [])])];
  if (sportIds.length) { conditions.push(`c.sport_id IN (${sportIds.map(() => "?").join(",")})`); parameters.push(...sportIds); }
  if (competitionIds.length) { conditions.push(`m.competition_id IN (${competitionIds.map(() => "?").join(",")})`); parameters.push(...competitionIds); }
  if (filters?.seasonId) { conditions.push("m.season_id = ?"); parameters.push(filters.seasonId); }
  if (teamIds.length) { conditions.push(`(m.home_team_id IN (${teamIds.map(() => "?").join(",")}) OR m.away_team_id IN (${teamIds.map(() => "?").join(",")}))`); parameters.push(...teamIds, ...teamIds); }
  if (filters?.status) { conditions.push("m.status = ?"); parameters.push(filters.status); }
  if (filters?.from) { conditions.push("m.starts_at >= ?"); parameters.push(filters.from); }
  if (filters?.to) { conditions.push("m.starts_at <= ?"); parameters.push(filters.to); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filters?.limit ?? 100, 1), 100);
  const offset = Math.max(filters?.offset ?? 0, 0);
  const rows = getDatabase().prepare(`SELECT m.id FROM matches m JOIN competitions c ON c.id = m.competition_id ${where} ORDER BY m.starts_at ASC LIMIT ? OFFSET ?`).all(...parameters, limit, offset) as Array<{ id: string }>;
  return rows.map((row) => getCanonicalFixtureById(row.id)).filter(Boolean);
}

export function deleteCanonicalFixture(fixtureId: string): boolean {
  const database = getDatabase();
  if (!database.prepare("SELECT id FROM matches WHERE id = ?").get(fixtureId)) return false;
  database.exec("BEGIN TRANSACTION;");
  try {
    database.prepare("UPDATE news_articles SET match_id = NULL WHERE match_id = ?").run(fixtureId);
    database.prepare("DELETE FROM scheduling_match_links WHERE match_id = ?").run(fixtureId);
    database.prepare("DELETE FROM publication_artifacts WHERE match_id = ?").run(fixtureId);
    database.prepare("DELETE FROM lineup_player_assignments WHERE lineup_id IN (SELECT id FROM fixture_lineups WHERE fixture_id = ?)").run(fixtureId);
    database.prepare("DELETE FROM fixture_lineups WHERE fixture_id = ?").run(fixtureId);
    const result = database.prepare("DELETE FROM matches WHERE id = ?").run(fixtureId);
    database.exec("COMMIT;");
    return result.changes > 0;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}
