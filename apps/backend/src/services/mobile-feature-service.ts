import crypto from "node:crypto";
import { getDatabase } from "../db/connection.js";

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

function normalizeEnabledValue(value: number | boolean | string | null | undefined): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return Boolean(Number(value));
}

export function normalizeNavigation(rows: Array<MobileFeatureNavigationRow>) {
  const featureMap = new Map(rows.map((r) => [r.feature_key, r]));
  console.log("[NAV MAP]", Array.from(featureMap.keys()));

  const getEnabled = (key: string) => Boolean(Number(featureMap.get(key)?.enabled));

  const navigation = {
    liveScores: {
      enabled: getEnabled("navigation.liveScores"),
      message: featureMap.get("navigation.liveScores")?.display_message ?? null
    },
    sports: {
      enabled: getEnabled("navigation.sports"),
      message: featureMap.get("navigation.sports")?.display_message ?? null
    },
    live: {
      enabled: getEnabled("navigation.live"),
      message: featureMap.get("navigation.live")?.display_message ?? null
    }
  };

  console.log("[MOBILE NORMALIZED]", JSON.stringify(navigation));
  console.log("[FINAL NAV OUTPUT]", JSON.stringify(navigation, null, 2));
  return navigation;
}

let cachedFeatures: MobileFeaturesResponse | null = null;
let cacheUpdatedAt: number | null = null;
const CACHE_TTL_MS = 60 * 1000;

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
    const now = Date.now();
    if (cachedFeatures && cacheUpdatedAt && now - cacheUpdatedAt < CACHE_TTL_MS) {
      return cachedFeatures;
    }

    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT feature_key, enabled, display_message FROM mobile_feature_flags WHERE feature_key LIKE 'navigation.%' ORDER BY feature_key`
      )
      .all() as Array<MobileFeatureNavigationRow>;

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

    if (rows.length === 0) {
      console.warn("[MOBILE_FEATURES_DB_EMPTY] mobile_feature_flags contains no navigation rows; using default navigation flags");
    }

    if (missingFeatures.length > 0) {
      const nowIso = new Date().toISOString();
      for (const missing of missingFeatures) {
        db.prepare(
          `INSERT OR IGNORE INTO mobile_feature_flags (id, feature_key, enabled, display_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(missing.id, missing.feature_key, 1, null, nowIso, nowIso);

        normalizedRows.push({
          feature_key: missing.feature_key,
          enabled: true,
          display_message: null
        });
      }
      console.warn(
        "[MOBILE_FEATURES_FALLBACK_USED] mobile feature flags were incomplete; initialized missing default navigation flags",
        missingFeatures.map((item) => item.feature_key)
      );
    }

    const response: MobileFeaturesResponse = {
      navigation: normalizeNavigation(normalizedRows)
    };

    cachedFeatures = response;
    cacheUpdatedAt = now;
    return response;
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

    if (missingFeatures.length > 0 || rows.length === 0) {
      for (const missing of missingFeatures) {
        db.prepare(
          `INSERT OR IGNORE INTO mobile_feature_flags (id, feature_key, enabled, display_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(missing.id, missing.feature_key, 1, null, nowIso, nowIso);
      }

      console.log("[MOBILE_FEATURES_REPAIR] repaired missing or invalid mobile_feature_flags navigation rows", {
        missingKeys: missingFeatures.map((item) => item.feature_key),
        rowCount: rows.length
      });
      cachedFeatures = null;
      cacheUpdatedAt = null;
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

    cachedFeatures = null;
    cacheUpdatedAt = null;

    return {
      enabled,
      message: normalizedMessage
    };
  }
}
