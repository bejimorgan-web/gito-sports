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

export const DEFAULT_NAVIGATION_FEATURES: MobileFeaturesResponse = {
  navigation: {
    liveScores: { enabled: true, message: null },
    sports: { enabled: true, message: null },
    live: { enabled: true, message: null }
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

export function normalizeNavigation(rows: Array<MobileFeatureNavigationRow>) {
  console.log("[DEPLOY CHECK] mobile-feature-service loaded");
  const featureMap = new Map(rows.map((r) => [r.feature_key, r]));
  console.log("[NAV MAP]", Array.from(featureMap.keys()));
  console.log("[RAW ENABLED TYPES]", rows.map((r) => typeof r.enabled));

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

  console.log("[MOBILE NORMALIZED]", JSON.stringify(navigation));
  console.log("[FINAL NAV OUTPUT]", JSON.stringify(navigation, null, 2));
  return navigation;
}

export class MobileFeatureService {
  static getFeatureFlag(featureKey: string): MobileFeatureFlag | null {
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

    console.debug("[MOBILE_FEATURES_DB_ROWS] found mobile_feature_flags navigation rows", {
      rowCount: rows.length,
      featureKeys: rows.map((row) => row.feature_key)
    });

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
        const enabled = legacyMap.has(missing.feature_key) ? legacyMap.get(missing.feature_key)! : true;
        db.prepare(
          `INSERT OR IGNORE INTO mobile_feature_flags (id, feature_key, enabled, display_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(missing.id, missing.feature_key, enabled ? 1 : 0, null, nowIso, nowIso);

        normalizedRows.push({
          feature_key: missing.feature_key,
          enabled,
          display_message: null
        });
      }
      console.warn(
        "[MOBILE_FEATURES_FALLBACK_USED] mobile feature flags were incomplete; initialized missing default navigation flags",
        missingFeatures.map((item) => item.feature_key)
      );
    }

    return {
      navigation: normalizeNavigation(normalizedRows)
    };
  }

  static repairMobileFeatureFlags(): void {
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
        const enabled = legacyMap.has(missing.feature_key) ? legacyMap.get(missing.feature_key)! : true;
        db.prepare(
          `INSERT OR IGNORE INTO mobile_feature_flags (id, feature_key, enabled, display_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(missing.id, missing.feature_key, enabled ? 1 : 0, null, nowIso, nowIso);

        normalizedRows.push({
          feature_key: missing.feature_key,
          enabled,
          display_message: null
        });
      }

      console.log("[MOBILE_FEATURES_REPAIR] repaired missing or invalid mobile_feature_flags navigation rows", {
        missingKeys: missingFeatures.map((item) => item.feature_key),
        migratedLegacyKeys: Array.from(legacyMap.keys()).filter((key) => missingFeatures.some((item) => item.feature_key === key)),
        rowCount: rows.length
      });
    }

    if (normalizedRows.length > 0) {
      console.debug("[MOBILE_FEATURES_REPAIR] normalized rows", normalizedRows);
    }
  }

  static updateNavigationFeature(
    featureKey: string,
    enabled: boolean,
    displayMessage: string | null
  ): MobileFeaturePayload {
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
