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
      .get(featureKey) as MobileFeatureFlag | undefined;
    return row ?? null;
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
      .all() as Array<{ feature_key: string; enabled: number; display_message: string | null }>;

    const response: MobileFeaturesResponse = {
      navigation: {
        liveScores: { enabled: true, message: null },
        sports: { enabled: true, message: null },
        live: { enabled: true, message: null }
      }
    };

    const mapping: Record<string, keyof MobileFeaturesResponse["navigation"]> = {
      "navigation.liveScores": "liveScores",
      "navigation.sports": "sports",
      "navigation.live": "live"
    };

    for (const row of rows) {
      const key = mapping[row.feature_key];
      if (key) {
        response.navigation[key] = {
          enabled: row.enabled === 1,
          message: row.display_message ?? null
        };
      }
    }

    cachedFeatures = response;
    cacheUpdatedAt = now;
    return response;
  }

  static updateNavigationFeature(
    featureKey: string,
    enabled: boolean,
    displayMessage: string | null
  ): MobileFeaturePayload {
    const db = getDatabase();
    const now = new Date().toISOString();

    const existing = this.getFeatureFlag(featureKey);
    if (!existing) {
      const id = DEFAULT_FEATURES.find((item) => item.feature_key === featureKey)?.id ?? crypto.randomUUID();
      db.prepare(
        `INSERT INTO mobile_feature_flags (id, feature_key, enabled, display_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, featureKey, enabled ? 1 : 0, displayMessage, now, now);
    } else {
      db.prepare(
        `UPDATE mobile_feature_flags SET enabled = ?, display_message = ?, updated_at = ? WHERE feature_key = ?`
      ).run(enabled ? 1 : 0, displayMessage, now, featureKey);
    }

    cachedFeatures = null;
    cacheUpdatedAt = null;

    return {
      enabled,
      message: displayMessage
    };
  }
}
