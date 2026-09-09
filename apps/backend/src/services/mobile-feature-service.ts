import crypto from "node:crypto";
import { getDatabase } from "../db/connection.js";

console.log("[RUNTIME VERSION]", process.env.NODE_ENV);

export type MobileFeatureFlag = {
  id: string;
  feature_key: string;
  enabled: boolean;
  display_message: string | null;
  created_at: string;
  updated_at: string;
};

export type MobileFeaturePayload = {
  enabled: boolean;
  message: string | null;
};

export type MobileFeaturesResponse = {
  navigation: {
    liveScores: MobileFeaturePayload;
    sports: MobileFeaturePayload;
    live: MobileFeaturePayload;
  };
};

const DEFAULT_FEATURES: ReadonlyArray<{ feature_key: string; id: string }> = [
  { feature_key: "navigation.liveScores", id: "flag_live_scores" },
  { feature_key: "navigation.sports", id: "flag_sports" },
  { feature_key: "navigation.live", id: "flag_live" }
];

const FEATURE_DEFAULTS: Record<string, boolean> = {
  "navigation.liveScores": true,
  "navigation.sports": true,
  "navigation.live": false,
};

export const DEFAULT_NAVIGATION_FEATURES: MobileFeaturesResponse = {
  navigation: {
    liveScores: { enabled: FEATURE_DEFAULTS["navigation.liveScores"] ?? true, message: null },
    sports: { enabled: FEATURE_DEFAULTS["navigation.sports"] ?? true, message: null },
    live: { enabled: FEATURE_DEFAULTS["navigation.live"] ?? false, message: null }
  }
};

type RawMobileFeatureFlagRow = {
  id: string;
  feature_key: string;
  enabled: number | boolean | string | null;
  display_message: string | null;
  created_at: string;
  updated_at: string;
};

export type MobileFeatureNavigationRow = {
  feature_key: string;
  enabled: number | boolean | string | null;
  display_message: string | null;
};

const toBool = (value: any): boolean => {
  return value === 1 || value === "1" || value === true || value === "true";
};

function normalizeEnabledValue(value: number | boolean | string | null | undefined): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  return toBool(value);
}

function getDefaultFeatureValue(featureKey: string): boolean {
  return FEATURE_DEFAULTS[featureKey] ?? true;
}

export class MobileFeatureService {
  private static ensureNavigationTables(): void {
    const db = getDatabase();

    db.exec(`
      CREATE TABLE IF NOT EXISTS mobile_features (
        id TEXT PRIMARY KEY,
        feature_name TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_mobile_features_feature_name ON mobile_features(feature_name);

      CREATE TABLE IF NOT EXISTS mobile_feature_flags (
        id TEXT PRIMARY KEY,
        feature_key TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        display_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_mobile_feature_flags_feature_key ON mobile_feature_flags(feature_key);
    `);

    db.exec(`
      INSERT OR IGNORE INTO mobile_features (id, feature_name, enabled, created_at, updated_at)
      VALUES
        ('nav_live_scores', 'navigation.liveScores', 1, datetime('now'), datetime('now')),
        ('nav_sports', 'navigation.sports', 1, datetime('now'), datetime('now')),
        ('nav_live', 'navigation.live', 0, datetime('now'), datetime('now'));

      INSERT OR IGNORE INTO mobile_feature_flags (id, feature_key, enabled, display_message, created_at, updated_at)
      VALUES
        ('flag_live_scores', 'navigation.liveScores', 1, NULL, datetime('now'), datetime('now')),
        ('flag_sports', 'navigation.sports', 1, NULL, datetime('now'), datetime('now')),
        ('flag_live', 'navigation.live', 0, NULL, datetime('now'), datetime('now'));

      UPDATE mobile_features
      SET enabled = 0, updated_at = datetime('now')
      WHERE feature_name = 'navigation.live';

      UPDATE mobile_feature_flags
      SET enabled = 0, display_message = NULL, updated_at = datetime('now')
      WHERE feature_key = 'navigation.live';
    `);
  }

  static getFeatureFlag(featureKey: string): MobileFeatureFlag | null {
    this.ensureNavigationTables();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT id, feature_key, enabled, display_message, created_at, updated_at FROM mobile_feature_flags WHERE feature_key = ?`
      )
      .get(featureKey) as RawMobileFeatureFlagRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      feature_key: row.feature_key,
      enabled: normalizeEnabledValue(row.enabled),
      display_message: row.display_message ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  static getNavigationFeatures(): MobileFeaturesResponse {
    this.ensureNavigationTables();
    const db = getDatabase();
    let rows = db
      .prepare(
        `SELECT feature_key, enabled, display_message FROM mobile_feature_flags WHERE feature_key LIKE 'navigation.%' ORDER BY feature_key`
      )
      .all() as Array<MobileFeatureNavigationRow>;

    if (rows.length === 0) {
      this.repairMobileFeatureFlags();
      rows = db
        .prepare(
          `SELECT feature_key, enabled, display_message FROM mobile_feature_flags WHERE feature_key LIKE 'navigation.%' ORDER BY feature_key`
        )
        .all() as Array<MobileFeatureNavigationRow>;
    }

    if (rows.length === 0) {
      console.info("[mobile-feature-service] no navigation feature rows found; initializing defaults");
    }

    const normalizedRows = rows.map((row) => ({
      feature_key: row.feature_key,
      enabled: normalizeEnabledValue(row.enabled),
      display_message: row.display_message ?? null
    }));
    const existingKeys = new Set(normalizedRows.map((row) => row.feature_key));
    const missingFeatures = DEFAULT_FEATURES.filter((item) => !existingKeys.has(item.feature_key));

    const legacyRows = db
      .prepare(`SELECT feature_name, enabled FROM mobile_features WHERE feature_name LIKE 'navigation.%' ORDER BY feature_name`)
      .all() as Array<{ feature_name: string; enabled: number | boolean | string | null }>;
    const legacyMap = new Map(legacyRows.map((row) => [row.feature_name, normalizeEnabledValue(row.enabled)]));

    if (rows.length === 0) {
      console.warn("[MOBILE_FEATURES_DB_EMPTY] mobile_feature_flags contains no navigation rows; using default navigation flags");
    }

    if (missingFeatures.length > 0) {
      const nowIso = new Date().toISOString();
      for (const missing of missingFeatures) {
        const enabled = legacyMap.has(missing.feature_key)
          ? legacyMap.get(missing.feature_key)!
          : getDefaultFeatureValue(missing.feature_key);
        db.prepare(
          `INSERT OR IGNORE INTO mobile_feature_flags (id, feature_key, enabled, display_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(missing.id, missing.feature_key, enabled ? 1 : 0, null, nowIso, nowIso);

        normalizedRows.push({
          feature_key: missing.feature_key,
          enabled,
          display_message: null
        });
      }
      console.info("[mobile-feature-service] initialized missing navigation features", {
        missingKeys: missingFeatures.map((item) => item.feature_key)
      });
    }

    return {
      navigation: normalizeNavigation(normalizedRows)
    };
  }

  static repairMobileFeatureFlags(): void {
    this.ensureNavigationTables();
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT id, feature_key, enabled, display_message FROM mobile_feature_flags WHERE feature_key LIKE 'navigation.%' ORDER BY feature_key`
      )
      .all() as RawMobileFeatureFlagRow[];

    const nowIso = new Date().toISOString();
    const normalizedRows = rows.map((row) => {
      const enabled = normalizeEnabledValue(row.enabled);
      const normalizedMessage = row.display_message ?? null;

      const shouldUpdate =
        row.enabled === null ||
        row.enabled === undefined ||
        typeof row.enabled === "boolean" ||
        typeof row.enabled === "string" ||
        (typeof row.enabled === "number" && row.enabled !== 0 && row.enabled !== 1);

      if (shouldUpdate) {
        db.prepare(
          `UPDATE mobile_feature_flags SET enabled = ?, display_message = ?, updated_at = ? WHERE id = ?`
        ).run(enabled ? 1 : 0, normalizedMessage, nowIso, row.id);
      }

      return {
        feature_key: row.feature_key,
        enabled,
        display_message: normalizedMessage
      };
    });

    const existingKeys = new Set(normalizedRows.map((row) => row.feature_key));
    const missingFeatures = DEFAULT_FEATURES.filter((item) => !existingKeys.has(item.feature_key));

    const legacyRows = db
      .prepare(`SELECT feature_name, enabled FROM mobile_features WHERE feature_name LIKE 'navigation.%' ORDER BY feature_name`)
      .all() as Array<{ feature_name: string; enabled: number | boolean | string | null }>;
    const legacyMap = new Map(legacyRows.map((row) => [row.feature_name, normalizeEnabledValue(row.enabled)]));

    if (missingFeatures.length > 0 || rows.length === 0) {
      for (const missing of missingFeatures) {
        const enabled = legacyMap.has(missing.feature_key)
          ? legacyMap.get(missing.feature_key)!
          : getDefaultFeatureValue(missing.feature_key);
        db.prepare(
          `INSERT OR IGNORE INTO mobile_feature_flags (id, feature_key, enabled, display_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(missing.id, missing.feature_key, enabled ? 1 : 0, null, nowIso, nowIso);

        normalizedRows.push({
          feature_key: missing.feature_key,
          enabled,
          display_message: null
        });
      }

      console.info("[mobile-feature-service] repaired navigation feature rows", {
        missingKeys: missingFeatures.map((item) => item.feature_key),
        rowCount: rows.length
      });
    }

  }

  static updateNavigationFeature(
    featureKey: string,
    enabled: boolean,
    displayMessage: string | null
  ): MobileFeaturePayload {
    this.ensureNavigationTables();
    const db = getDatabase();
    const now = new Date().toISOString();
    const normalizedMessage = displayMessage ?? null;

    const existing = this.getFeatureFlag(featureKey);
    if (!existing) {
      const id = DEFAULT_FEATURES.find((item) => item.feature_key === featureKey)?.id ?? crypto.randomUUID();
      db.prepare(
        `INSERT INTO mobile_feature_flags (id, feature_key, enabled, display_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, featureKey, enabled ? 1 : 0, normalizedMessage, now, now);
    } else {
      db.prepare(
        `UPDATE mobile_feature_flags SET enabled = ?, display_message = ?, updated_at = ? WHERE feature_key = ?`
      ).run(enabled ? 1 : 0, normalizedMessage, now, featureKey);
    }

    return {
      enabled,
      message: normalizedMessage
    };
  }
}

export function normalizeNavigation(rows: Array<MobileFeatureNavigationRow>) {
  const featureMap = new Map(rows.map((r) => [r.feature_key, r]));

  const getEnabled = (key: string) => toBool(featureMap.get(key)?.enabled);
  const getMessage = (key: string) => featureMap.get(key)?.display_message ?? null;

  const navigation = {
    liveScores: {
      enabled: getEnabled("navigation.liveScores"),
      message: getMessage("navigation.liveScores")
    },
    sports: {
      enabled: getEnabled("navigation.sports"),
      message: getMessage("navigation.sports")
    },
    live: {
      enabled: getEnabled("navigation.live"),
      message: getMessage("navigation.live")
    }
  };

  return navigation;
}

