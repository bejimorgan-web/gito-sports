import crypto from "node:crypto";
import type {
  Match,
  PublicationArtifact,
  PublicationAvailability,
  PublicationCapability,
  PublicationStatus
} from "@gito/shared";
import type { PublicationPlaybackMode } from "@gito/shared";
import { getDatabase } from "../db/connection.js";
import {
  PUBLICATION_ARTIFACT_SCHEMA_VERSION,
  assertPublicationAvailability,
  assertPublicationCapability,
  assertPublicationStatus,
  assertPublicationStatusTransition,
  validatePublicationSourceReference,
  validatePublicationDeliveryUrl
} from "../services/publication-artifact.js";

type PublicationRow = {
  publication_id: string;
  match_id: string;
  schema_version: number;
  source_reference: string;
  capability: PublicationCapability;
  publication_status: PublicationStatus;
  availability: PublicationAvailability;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  revoked_at: string | null;
};

const createTableSql = `
  CREATE TABLE IF NOT EXISTS publication_artifacts (
    publication_id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    source_reference TEXT NOT NULL,
    capability TEXT NOT NULL CHECK (capability IN ('live')),
    publication_status TEXT NOT NULL CHECK (publication_status IN ('draft', 'approved', 'published', 'revoked', 'unavailable')),
    availability TEXT NOT NULL CHECK (availability IN ('ready', 'degraded', 'offline', 'unknown')),
    expires_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT,
    revoked_at TEXT,
    FOREIGN KEY (match_id) REFERENCES matches(id)
  );
  CREATE INDEX IF NOT EXISTS idx_publication_artifacts_match ON publication_artifacts(match_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_publication_artifacts_status ON publication_artifacts(publication_status, availability);
  CREATE TABLE IF NOT EXISTS publication_delivery (
    publication_id TEXT PRIMARY KEY,
    delivery_reference TEXT NOT NULL,
    playback_mode TEXT NOT NULL DEFAULT 'DIRECT_SAFE',
    playback_url TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (publication_id) REFERENCES publication_artifacts(publication_id) ON DELETE CASCADE
  );
`;

let schemaReady = false;

function now() {
  return new Date().toISOString();
}

function ensureSchema() {
  if (schemaReady) return;
  const database = getDatabase();
  database.exec(createTableSql);
  const deliveryColumns = database.prepare("PRAGMA table_info(publication_delivery)").all() as Array<{ name: string }>;
  if (!deliveryColumns.some((column) => column.name === "playback_mode")) {
    database.exec("ALTER TABLE publication_delivery ADD COLUMN playback_mode TEXT NOT NULL DEFAULT 'DIRECT_SAFE'");
  }
  const table = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'publication_artifacts'").get() as { sql?: string } | undefined;
  if (table?.sql && !table.sql.includes("'approved'")) {
    database.exec("PRAGMA foreign_keys = OFF;");
    try {
      database.exec("BEGIN TRANSACTION;");
      database.exec("ALTER TABLE publication_artifacts RENAME TO publication_artifacts_legacy_approval;");
      database.exec(createTableSql);
      database.exec(`
        INSERT INTO publication_artifacts (
          publication_id, match_id, schema_version, source_reference, capability,
          publication_status, availability, expires_at, created_at, updated_at,
          published_at, revoked_at
        )
        SELECT publication_id, match_id, schema_version, source_reference, capability,
          publication_status, availability, expires_at, created_at, updated_at,
          published_at, revoked_at
        FROM publication_artifacts_legacy_approval
      `);
      database.exec("DROP TABLE publication_artifacts_legacy_approval;");
      database.exec("CREATE INDEX IF NOT EXISTS idx_publication_artifacts_match ON publication_artifacts(match_id, created_at);");
      database.exec("CREATE INDEX IF NOT EXISTS idx_publication_artifacts_status ON publication_artifacts(publication_status, availability);");
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    } finally {
      database.exec("PRAGMA foreign_keys = ON;");
    }
  }
  schemaReady = true;
}

function mapPublication(row: PublicationRow): PublicationArtifact {
  return {
    schemaVersion: row.schema_version,
    publicationId: row.publication_id,
    matchId: row.match_id,
    sourceReference: row.source_reference,
    capability: row.capability,
    publicationStatus: row.publication_status,
    availability: row.availability,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    revokedAt: row.revoked_at
  };
}

function getRow(publicationId: string) {
  return getDatabase().prepare("SELECT * FROM publication_artifacts WHERE publication_id = ?").get(publicationId) as PublicationRow | undefined;
}

export function createPublicationArtifact(input: {
  matchId: string;
  sourceReference: string;
  capability?: PublicationCapability;
  publicationStatus?: PublicationStatus;
  availability?: PublicationAvailability;
  expiresAt?: string | null;
  publicationId?: string;
}) {
  ensureSchema();
  if (!input.matchId.trim()) throw new Error("publication_match_id_required");
  const sourceReference = validatePublicationSourceReference(input.sourceReference);
  const capability = input.capability ?? "live";
  const publicationStatus = input.publicationStatus ?? "draft";
  const availability = input.availability ?? "unknown";
  assertPublicationCapability(capability);
  assertPublicationStatus(publicationStatus);
  assertPublicationAvailability(availability);

  if (!getDatabase().prepare("SELECT 1 FROM matches WHERE id = ?").get(input.matchId)) {
    throw new Error("publication_match_not_found");
  }

  const timestamp = now();
  const publicationId = input.publicationId ?? `publication_${crypto.randomUUID()}`;
  const publishedAt = publicationStatus === "published" ? timestamp : null;
  const revokedAt = publicationStatus === "revoked" ? timestamp : null;
  const existing = getRow(publicationId);
  if (existing) {
    if (existing.match_id !== input.matchId || existing.source_reference !== sourceReference) {
      throw new Error("publication_id_conflict");
    }
    return mapPublication(existing);
  }
  getDatabase().prepare(`
    INSERT INTO publication_artifacts (
      publication_id, match_id, schema_version, source_reference, capability,
      publication_status, availability, expires_at, created_at, updated_at,
      published_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    publicationId,
    input.matchId,
    PUBLICATION_ARTIFACT_SCHEMA_VERSION,
    sourceReference,
    capability,
    publicationStatus,
    availability,
    input.expiresAt ?? null,
    timestamp,
    timestamp,
    publishedAt,
    revokedAt
  );

  return getPublicationArtifactById(publicationId)!;
}

export function getPublicationArtifactById(publicationId: string) {
  ensureSchema();
  const row = getRow(publicationId);
  return row ? mapPublication(row) : undefined;
}

export function getPublicationArtifactByMatchId(matchId: string) {
  ensureSchema();
  const row = getDatabase()
    .prepare("SELECT * FROM publication_artifacts WHERE match_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(matchId) as PublicationRow | undefined;
  return row ? mapPublication(row) : undefined;
}

export function getPublishedPublicationDeliveryByMatchId(matchId: string): { playbackUrl: string; deliveryReference: string; playbackMode: PublicationPlaybackMode } | undefined {
  ensureSchema();
  const row = getDatabase().prepare(`
    SELECT delivery.delivery_reference, delivery.playback_mode, delivery.playback_url
    FROM publication_artifacts artifact
    JOIN publication_delivery delivery ON delivery.publication_id = artifact.publication_id
    WHERE artifact.match_id = ?
      AND artifact.publication_status = 'published'
      AND (artifact.expires_at IS NULL OR artifact.expires_at > ?)
    ORDER BY COALESCE(artifact.published_at, artifact.updated_at) DESC, artifact.publication_id DESC
    LIMIT 1
  `).get(matchId, now()) as { delivery_reference: string; playback_mode: PublicationPlaybackMode; playback_url: string } | undefined;

  return row
    ? { playbackUrl: row.playback_url, deliveryReference: row.delivery_reference, playbackMode: row.playback_mode }
    : undefined;
}

export function listPublishedPublicationFeed() {
  ensureSchema();
  const nowAt = now();
  const rows = getDatabase().prepare(`
    SELECT
      pa.*,
      m.status AS match_status,
      m.competition_id,
      m.season_id,
      m.home_team_id,
      m.away_team_id,
      m.starts_at,
      m.venue_name,
      m.created_at AS match_created_at,
      m.updated_at AS match_updated_at,
      home.name AS home_team_name,
      away.name AS away_team_name,
      home.logo_url AS home_team_logo_url,
      away.logo_url AS away_team_logo_url,
      competition.name AS competition_name,
      competition.logo_url AS competition_logo_url,
      host.name AS host_name,
      host.logo_url AS host_logo_url,
      country.name AS country_name,
      country.logo_url AS country_logo_url,
      country.flag_url AS country_flag_url,
      region.name AS region_name,
      country_region.name AS country_region_name,
      sport.name AS sport_name,
      sport.logo_url AS sport_logo_url,
      delivery.delivery_reference,
      delivery.playback_mode,
      delivery.playback_url
    FROM publication_artifacts pa
    JOIN matches m ON m.id = pa.match_id
    LEFT JOIN teams home ON home.id = m.home_team_id
    LEFT JOIN teams away ON away.id = m.away_team_id
    LEFT JOIN competitions competition ON competition.id = m.competition_id
    LEFT JOIN hosts host ON host.id = competition.host_id
    LEFT JOIN countries country ON country.id = competition.country_id
    LEFT JOIN regions region ON region.id = competition.region_id
    LEFT JOIN regions country_region ON country_region.id = country.region_id
    LEFT JOIN sports sport ON sport.id = competition.sport_id
    LEFT JOIN publication_delivery delivery ON delivery.publication_id = pa.publication_id
    WHERE pa.publication_status = 'published'
      AND (pa.expires_at IS NULL OR pa.expires_at > ?)
      AND NOT EXISTS (
        SELECT 1
        FROM publication_artifacts newer
        WHERE newer.match_id = pa.match_id
          AND newer.publication_status = 'published'
          AND (newer.expires_at IS NULL OR newer.expires_at > ?)
          AND (
            COALESCE(newer.published_at, newer.updated_at) > COALESCE(pa.published_at, pa.updated_at)
            OR (
              COALESCE(newer.published_at, newer.updated_at) = COALESCE(pa.published_at, pa.updated_at)
              AND newer.publication_id > pa.publication_id
            )
          )
      )
    ORDER BY COALESCE(pa.published_at, pa.updated_at) DESC, pa.publication_id DESC
  `).all(nowAt, nowAt) as Array<PublicationRow & {
    match_status: Match["status"];
    competition_id: string;
    season_id: string | null;
    home_team_id: string;
    away_team_id: string;
    starts_at: string;
    venue_name: string | null;
    match_created_at: string;
    match_updated_at: string;
    home_team_name: string | null;
    away_team_name: string | null;
    home_team_logo_url: string | null;
    away_team_logo_url: string | null;
    competition_name: string | null;
    competition_logo_url: string | null;
    host_name: string | null;
    host_logo_url: string | null;
    country_name: string | null;
    country_logo_url: string | null;
    country_flag_url: string | null;
    region_name: string | null;
    country_region_name: string | null;
    sport_name: string | null;
    sport_logo_url: string | null;
    delivery_reference: string | null;
    playback_mode: PublicationPlaybackMode | null;
    playback_url: string | null;
  }>;

  return rows.map((row) => ({
    publication: mapPublication(row),
    match: {
      id: row.match_id,
      competitionId: row.competition_id,
      homeTeamId: row.home_team_id,
      awayTeamId: row.away_team_id,
      startsAt: row.starts_at,
      status: row.match_status,
      createdAt: row.match_created_at,
      updatedAt: row.match_updated_at,
      ...(row.season_id ? { seasonId: row.season_id } : {}),
      ...(row.venue_name ? { venueName: row.venue_name } : {}),
      ...(row.home_team_name ? { homeTeamName: row.home_team_name } : {}),
      ...(row.away_team_name ? { awayTeamName: row.away_team_name } : {}),
      ...(row.home_team_logo_url ? { homeTeamLogoUrl: row.home_team_logo_url } : {}),
      ...(row.away_team_logo_url ? { awayTeamLogoUrl: row.away_team_logo_url } : {}),
      ...(row.competition_name ? { competitionName: row.competition_name } : {}),
      ...(row.competition_logo_url ? { competitionLogoUrl: row.competition_logo_url } : {}),
      ...(row.sport_name ? { sportName: row.sport_name } : {}),
      ...(row.sport_logo_url ? { sportLogoUrl: row.sport_logo_url } : {}),
      ...(row.host_name ? { hostName: row.host_name } : {}),
      ...(row.host_logo_url ? { hostLogoUrl: row.host_logo_url } : {}),
      ...(row.country_name ? { countryName: row.country_name } : {}),
      ...(row.country_logo_url || row.country_flag_url
        ? { countryLogoUrl: row.country_logo_url ?? row.country_flag_url }
        : {}),
      ...(row.region_name || row.country_region_name
        ? { regionName: row.region_name ?? row.country_region_name }
        : {})
    },
    ...(row.delivery_reference ? { deliveryReference: row.delivery_reference } : {}),
    ...(row.playback_mode ? { playbackMode: row.playback_mode } : {}),
    ...(row.playback_url ? { playbackUrl: row.playback_url } : {})
  }));
}

export function bindPublicationArtifact(publicationId: string, matchId: string) {
  ensureSchema();
  const current = getRow(publicationId);
  if (!current) return undefined;
  if (current.match_id !== matchId) throw new Error("publication_match_conflict");
  return mapPublication(current);
}

/** Stores the selected direct playback URL and its explicit delivery mode. */
export function setPublicationDelivery(publicationId: string, input: { deliveryReference: string; playbackUrl: string; playbackMode?: PublicationPlaybackMode }) {
  ensureSchema();
  if (!getRow(publicationId)) return undefined;
  const deliveryReference = validatePublicationSourceReference(input.deliveryReference);
  const playbackMode = input.playbackMode ?? "DIRECT_SAFE";
  const playbackUrl = new URL(validatePublicationDeliveryUrl(input.playbackUrl, playbackMode));
  getDatabase().prepare(`INSERT INTO publication_delivery (publication_id, delivery_reference, playback_mode, playback_url, updated_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(publication_id) DO UPDATE SET delivery_reference = excluded.delivery_reference, playback_mode = excluded.playback_mode, playback_url = excluded.playback_url, updated_at = excluded.updated_at`)
    .run(publicationId, deliveryReference, playbackMode, playbackUrl.toString(), now());
  return getPublicationArtifactById(publicationId);
}

export function updatePublicationArtifact(
  publicationId: string,
  input: { publicationStatus?: PublicationStatus; availability?: PublicationAvailability; expiresAt?: string | null }
) {
  ensureSchema();
  const current = getRow(publicationId);
  if (!current) return undefined;

  if (input.publicationStatus !== undefined) {
    assertPublicationStatus(input.publicationStatus);
    assertPublicationStatusTransition(current.publication_status, input.publicationStatus);
  }
  if (input.availability !== undefined) assertPublicationAvailability(input.availability);

  const nextStatus = input.publicationStatus ?? current.publication_status;
  const timestamp = now();
  const publishedAt = nextStatus === "published" ? current.published_at ?? timestamp : current.published_at;
  const revokedAt = nextStatus === "revoked" ? current.revoked_at ?? timestamp : current.revoked_at;
  getDatabase().prepare(`
    UPDATE publication_artifacts
    SET publication_status = ?, availability = ?, expires_at = ?, updated_at = ?,
        published_at = ?, revoked_at = ?
    WHERE publication_id = ?
  `).run(
    nextStatus,
    input.availability ?? current.availability,
    input.expiresAt === undefined ? current.expires_at : input.expiresAt,
    timestamp,
    publishedAt,
    revokedAt,
    publicationId
  );

  return getPublicationArtifactById(publicationId);
}

export function publishPublicationArtifact(publicationId: string) {
  return updatePublicationArtifact(publicationId, { publicationStatus: "published" });
}

export function approvePublicationArtifact(publicationId: string) {
  return updatePublicationArtifact(publicationId, { publicationStatus: "approved" });
}

export function revokePublicationArtifact(publicationId: string) {
  return updatePublicationArtifact(publicationId, { publicationStatus: "revoked", availability: "offline" });
}

export function resetPublicationArtifactRepositoryForTests() {
  schemaReady = false;
}
