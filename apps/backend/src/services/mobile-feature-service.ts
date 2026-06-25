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

function normalizeEnabledValue(value: number | boolean | string | null | undefined): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  const normalized = value.toString().trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

function normalizeMobileFeatureRow(row: RawMobileFeatureFlagRow) {
  return {
    feature_key: row.feature_key,
    enabled: normalizeEnabledValue(row.enabled),
    display_message: row.display_message ?? null
  };
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
      ...row,
      enabled: normalizeEnabledValue(row.enabled)
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
      .all() as RawMobileFeatureFlagRow[];

    console.debug("[MOBILE_FEATURES_DB_ROWS] found mobile_feature_flags navigation rows", {
      rowCount: rows.length,
      featureKeys: rows.map((row) => row.feature_key)
    });

    const normalizedRows = rows.map(normalizeMobileFeatureRow);
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

    const rowsByKey = new Map(normalizedRows.map((row) => [row.feature_key, row]));

    const response: MobileFeaturesResponse = {
      navigation: {
        liveScores: {
          enabled: Boolean(rowsByKey.get("navigation.liveScores")?.enabled),
          message: rowsByKey.get("navigation.liveScores")?.display_message ?? null
        },
        sports: {
          enabled: Boolean(rowsByKey.get("navigation.sports")?.enabled),
          message: rowsByKey.get("navigation.sports")?.display_message ?? null
        },
        live: {
          enabled: Boolean(rowsByKey.get("navigation.live")?.enabled),
          message: rowsByKey.get("navigation.live")?.display_message ?? null
        }
      }
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
