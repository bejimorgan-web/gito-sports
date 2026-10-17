import crypto from "node:crypto";
import type { DatabaseSync } from "../db/sqlite.js";

export interface CreateScheduleManifestInput {
  competitionId: string;
  seasonId: string;
  createdAt?: string;
}

export interface ScheduleSourceAttestation {
  name: string;
  reference: string;
  contentHash: string;
}

export interface ExpectedScheduleFixtureInput {
  fixtureKey: string;
  homeTeamId: string;
  awayTeamId: string;
  matchId?: string | null;
}

export interface ScheduleManifestFixture extends ExpectedScheduleFixtureInput {
  matchId: string | null;
}

export interface ScheduleManifestFinding {
  code: string;
  message: string;
  fixtureKey?: string;
  matchId?: string;
}

export interface ScheduleManifestValidation {
  valid: boolean;
  complete: boolean;
  findings: ScheduleManifestFinding[];
}

export interface ScheduleManifestRecord {
  id: string;
  competitionId: string;
  seasonId: string;
  version: number;
  state: "draft" | "finalized";
  supersedesManifestId: string | null;
  contentHash: string | null;
  createdAt: string;
  finalizedAt: string | null;
  source: ScheduleSourceAttestation | null;
  fixtures: ScheduleManifestFixture[];
  validation: ScheduleManifestValidation;
}

interface ManifestRow {
  id: string;
  competition_id: string;
  season_id: string;
  version: number;
  state: "draft" | "finalized";
  supersedes_manifest_id: string | null;
  content_hash: string | null;
  created_at: string;
  finalized_at: string | null;
  source_name: string | null;
  source_reference: string | null;
  source_content_hash: string | null;
}

interface ManifestFixtureRow {
  fixture_key: string;
  home_team_id: string;
  away_team_id: string;
  match_id: string | null;
}

interface CanonicalFixtureRow {
  id: string;
  competition_id: string;
  season_id: string | null;
  home_team_id: string;
  away_team_id: string;
}

function withImmediateTransaction<T>(database: DatabaseSync, action: () => T): T {
  if (database.inTransaction) {
    return action();
  }
  database.exec("BEGIN IMMEDIATE;");
  try {
    const result = action();
    database.exec("COMMIT;");
    return result;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readManifest(database: DatabaseSync, manifestId: string): ManifestRow | undefined {
  return database.prepare(`
    SELECT id, competition_id, season_id, version, state, supersedes_manifest_id,
           content_hash, created_at, finalized_at, source_name, source_reference, source_content_hash
    FROM standings_schedule_manifests
    WHERE id = ?
  `).get(manifestId) as ManifestRow | undefined;
}

function readFixtures(database: DatabaseSync, manifestId: string): ManifestFixtureRow[] {
  return database.prepare(`
    SELECT fixture_key, home_team_id, away_team_id, match_id
    FROM standings_schedule_manifest_fixtures
    WHERE manifest_id = ?
    ORDER BY fixture_key
  `).all(manifestId) as ManifestFixtureRow[];
}

function validateManifest(
  database: DatabaseSync,
  manifest: ManifestRow,
  entries = readFixtures(database, manifest.id)
): ScheduleManifestValidation {
  const findings: ScheduleManifestFinding[] = [];
  const registeredIds = new Set<string>();

  if (entries.length === 0) {
    findings.push({
      code: "EMPTY_MANIFEST",
      message: "a schedule manifest must explicitly list at least one expected fixture"
    });
  }

  for (const entry of entries) {
    if (!entry.match_id) {
      findings.push({
        code: "UNRESOLVED_EXPECTED_FIXTURE",
        message: "expected fixture has not yet been matched to a canonical fixture",
        fixtureKey: entry.fixture_key
      });
      continue;
    }
    if (registeredIds.has(entry.match_id)) {
      findings.push({
        code: "DUPLICATE_CANONICAL_FIXTURE",
        message: "canonical fixture is assigned to more than one expected fixture",
        fixtureKey: entry.fixture_key,
        matchId: entry.match_id
      });
      continue;
    }
    registeredIds.add(entry.match_id);
    const fixture = database.prepare(`
      SELECT id, competition_id, season_id, home_team_id, away_team_id
      FROM matches
      WHERE id = ?
    `).get(entry.match_id) as CanonicalFixtureRow | undefined;
    if (!fixture) {
      findings.push({
        code: "UNKNOWN_CANONICAL_FIXTURE",
        message: "expected fixture references a canonical fixture that does not exist",
        fixtureKey: entry.fixture_key,
        matchId: entry.match_id
      });
      continue;
    }
    if (fixture.competition_id !== manifest.competition_id || fixture.season_id !== manifest.season_id) {
      findings.push({
        code: "CANONICAL_FIXTURE_SCOPE_MISMATCH",
        message: "canonical fixture belongs to a different competition or season",
        fixtureKey: entry.fixture_key,
        matchId: entry.match_id
      });
    }
    if (fixture.home_team_id !== entry.home_team_id || fixture.away_team_id !== entry.away_team_id) {
      findings.push({
        code: "CANONICAL_FIXTURE_PARTICIPANT_MISMATCH",
        message: "expected home and away teams do not match the canonical fixture",
        fixtureKey: entry.fixture_key,
        matchId: entry.match_id
      });
    }
  }

  const canonicalFixtures = database.prepare(`
    SELECT id
    FROM matches
    WHERE competition_id = ? AND season_id = ?
    ORDER BY id
  `).all(manifest.competition_id, manifest.season_id) as Array<{ id: string }>;
  for (const fixture of canonicalFixtures) {
    if (!registeredIds.has(fixture.id)) {
      findings.push({
        code: "CANONICAL_FIXTURE_OMITTED",
        message: "canonical fixture is absent from the schedule manifest",
        matchId: fixture.id
      });
    }
  }

  findings.sort((left, right) => compareText(
    `${left.fixtureKey ?? ""}\u0000${left.matchId ?? ""}\u0000${left.code}\u0000${left.message}`,
    `${right.fixtureKey ?? ""}\u0000${right.matchId ?? ""}\u0000${right.code}\u0000${right.message}`
  ));
  const invalidCodes = new Set([
    "EMPTY_MANIFEST",
    "DUPLICATE_CANONICAL_FIXTURE",
    "UNKNOWN_CANONICAL_FIXTURE",
    "CANONICAL_FIXTURE_SCOPE_MISMATCH",
    "CANONICAL_FIXTURE_PARTICIPANT_MISMATCH"
  ]);
  return {
    valid: !findings.some(({ code }) => invalidCodes.has(code)),
    complete: findings.length === 0,
    findings
  };
}

function toManifestRecord(database: DatabaseSync, row: ManifestRow): ScheduleManifestRecord {
  return {
    id: row.id,
    competitionId: row.competition_id,
    seasonId: row.season_id,
    version: row.version,
    state: row.state,
    supersedesManifestId: row.supersedes_manifest_id,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    finalizedAt: row.finalized_at,
    source: row.source_name && row.source_reference && row.source_content_hash
      ? { name: row.source_name, reference: row.source_reference, contentHash: row.source_content_hash }
      : null,
    fixtures: readFixtures(database, row.id).map((entry) => ({
      fixtureKey: entry.fixture_key,
      homeTeamId: entry.home_team_id,
      awayTeamId: entry.away_team_id,
      matchId: entry.match_id
    })),
    validation: validateManifest(database, row)
  };
}

function validateIdentity(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim() !== value) {
    throw new Error(`[schedule-manifest] ${label} must be a non-empty, trimmed string`);
  }
}

export function createScheduleManifest(
  database: DatabaseSync,
  input: CreateScheduleManifestInput
): ScheduleManifestRecord {
  validateIdentity(input.competitionId, "competitionId");
  validateIdentity(input.seasonId, "seasonId");
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new Error("[schedule-manifest] createdAt must be a valid timestamp");
  }

  return withImmediateTransaction(database, () => {
    const latest = database.prepare(`
      SELECT id, state, version
      FROM standings_schedule_manifests
      WHERE competition_id = ? AND season_id = ?
      ORDER BY version DESC
      LIMIT 1
    `).get(input.competitionId, input.seasonId) as
      { id: string; state: "draft" | "finalized"; version: number } | undefined;
    if (latest?.state === "draft") {
      throw new Error(`[schedule-manifest] draft version ${latest.version} already exists; update that draft before creating another`);
    }
    const version = (latest?.version ?? 0) + 1;
    const id = crypto.randomUUID();
    database.prepare(`
      INSERT INTO standings_schedule_manifests (
        id, competition_id, season_id, version, state,
        supersedes_manifest_id, content_hash, created_at, finalized_at
      ) VALUES (?, ?, ?, ?, 'draft', ?, NULL, ?, NULL)
    `).run(id, input.competitionId, input.seasonId, version, latest?.id ?? null, createdAt);
    const created = readManifest(database, id);
    if (!created) {
      throw new Error("[schedule-manifest] created draft could not be read back");
    }
    return toManifestRecord(database, created);
  });
}

export function addExpectedScheduleFixture(
  database: DatabaseSync,
  manifestId: string,
  input: ExpectedScheduleFixtureInput
): ScheduleManifestRecord {
  validateIdentity(manifestId, "manifestId");
  validateIdentity(input.fixtureKey, "fixtureKey");
  validateIdentity(input.homeTeamId, "homeTeamId");
  validateIdentity(input.awayTeamId, "awayTeamId");
  if (input.homeTeamId === input.awayTeamId) {
    throw new Error("[schedule-manifest] expected home and away teams must differ");
  }
  if (input.matchId !== undefined && input.matchId !== null) {
    validateIdentity(input.matchId, "matchId");
  }
  return withImmediateTransaction(database, () => {
    const manifest = readManifest(database, manifestId);
    if (!manifest) {
      throw new Error(`[schedule-manifest] unknown manifest "${manifestId}"`);
    }
    if (manifest.state !== "draft") {
      throw new Error("[schedule-manifest] finalized manifest versions are immutable");
    }
    database.prepare(`
      INSERT INTO standings_schedule_manifest_fixtures (
        manifest_id, competition_id, season_id, fixture_key,
        home_team_id, away_team_id, match_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (manifest_id, fixture_key) DO UPDATE SET
        home_team_id = excluded.home_team_id,
        away_team_id = excluded.away_team_id,
        match_id = excluded.match_id
    `).run(
      manifestId,
      manifest.competition_id,
      manifest.season_id,
      input.fixtureKey,
      input.homeTeamId,
      input.awayTeamId,
      input.matchId ?? null
    );
    return toManifestRecord(database, manifest);
  });
}

export function resolveExpectedScheduleFixture(
  database: DatabaseSync,
  manifestId: string,
  fixtureKey: string,
  matchId: string
): ScheduleManifestRecord {
  validateIdentity(manifestId, "manifestId");
  validateIdentity(fixtureKey, "fixtureKey");
  validateIdentity(matchId, "matchId");
  return withImmediateTransaction(database, () => {
    const manifest = readManifest(database, manifestId);
    if (!manifest) {
      throw new Error(`[schedule-manifest] unknown manifest "${manifestId}"`);
    }
    if (manifest.state !== "draft") {
      throw new Error("[schedule-manifest] finalized manifest versions are immutable");
    }
    const result = database.prepare(`
      UPDATE standings_schedule_manifest_fixtures
      SET match_id = ?
      WHERE manifest_id = ? AND fixture_key = ?
    `).run(matchId, manifestId, fixtureKey);
    if (result.changes !== 1) {
      throw new Error(`[schedule-manifest] unknown expected fixture "${fixtureKey}"`);
    }
    return toManifestRecord(database, manifest);
  });
}

export function validateScheduleManifest(
  database: DatabaseSync,
  manifestId: string
): ScheduleManifestRecord {
  validateIdentity(manifestId, "manifestId");
  const manifest = readManifest(database, manifestId);
  if (!manifest) {
    throw new Error(`[schedule-manifest] unknown manifest "${manifestId}"`);
  }
  return toManifestRecord(database, manifest);
}

export function finalizeScheduleManifest(
  database: DatabaseSync,
  manifestId: string,
  finalizedAt = new Date().toISOString(),
  source?: ScheduleSourceAttestation
): ScheduleManifestRecord {
  validateIdentity(manifestId, "manifestId");
  if (Number.isNaN(Date.parse(finalizedAt))) {
    throw new Error("[schedule-manifest] finalizedAt must be a valid timestamp");
  }
  if (source && (source.name.trim() !== source.name || source.name.length < 2 || source.name.length > 200
    || source.reference.trim() !== source.reference || source.reference.length < 2 || source.reference.length > 1000
    || !/^[a-f0-9]{64}$/.test(source.contentHash))) {
    throw new Error("[schedule-manifest] source name and reference must be trimmed and within supported lengths");
  }
  if (source) {
    let parsedUrl: URL | undefined;
    try { parsedUrl = new URL(source.reference); } catch { /* An opaque internal document reference is also supported. */ }
    if (parsedUrl
      ? parsedUrl.protocol !== "https:" || Boolean(parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash)
      : !/^[A-Za-z0-9][A-Za-z0-9._:/-]{1,999}$/.test(source.reference)) {
      throw new Error("[schedule-manifest] source reference must be an HTTPS URL without credentials, query, or fragment, or an opaque document identifier");
    }
  }
  return withImmediateTransaction(database, () => {
    const manifest = readManifest(database, manifestId);
    if (!manifest) {
      throw new Error(`[schedule-manifest] unknown manifest "${manifestId}"`);
    }
    if (manifest.state !== "draft") {
      throw new Error("[schedule-manifest] manifest is already finalized");
    }
    const fixtures = readFixtures(database, manifestId);
    const validation = validateManifest(database, manifest, fixtures);
    if (!validation.valid) {
      throw new Error(`[schedule-manifest] manifest has invalid entries: ${validation.findings
        .filter(({ code }) => code !== "CANONICAL_FIXTURE_OMITTED" && code !== "UNRESOLVED_EXPECTED_FIXTURE")
        .map(({ code }) => code).join(", ")}`);
    }
    const canonicalContent = {
      competitionId: manifest.competition_id,
      seasonId: manifest.season_id,
      version: manifest.version,
      supersedesManifestId: manifest.supersedes_manifest_id,
      ...(source ? { source } : {}),
      fixtures: fixtures.map((entry) => ({
        fixtureKey: entry.fixture_key,
        homeTeamId: entry.home_team_id,
        awayTeamId: entry.away_team_id,
        matchId: entry.match_id
      }))
    };
    const contentHash = crypto.createHash("sha256").update(stableJson(canonicalContent)).digest("hex");
    database.prepare(`
      UPDATE standings_schedule_manifests
      SET state = 'finalized', content_hash = ?, finalized_at = ?, source_name = ?, source_reference = ?, source_content_hash = ?
      WHERE id = ?
    `).run(contentHash, finalizedAt, source?.name ?? null, source?.reference ?? null, source?.contentHash ?? null, manifestId);
    const finalized = readManifest(database, manifestId);
    if (!finalized) {
      throw new Error("[schedule-manifest] finalized manifest could not be read back");
    }
    return toManifestRecord(database, finalized);
  });
}

export function getScheduleManifest(
  database: DatabaseSync,
  manifestId: string
): ScheduleManifestRecord {
  return validateScheduleManifest(database, manifestId);
}
