import crypto from "node:crypto";
import { getDatabase } from "../db/connection.js";

export type MobileNavigationConfig = {
  liveScores: boolean;
  sports: boolean;
  live: boolean;
};

export type MobileFeature = {
  id: string;
  feature_name: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

const DEFAULT_FEATURES: ReadonlyArray<{ feature_key: string; id: string }> = [
  { feature_key: "navigation.liveScores", id: "flag_live_scores" },
  { feature_key: "navigation.sports", id: "flag_sports" },
  { feature_key: "navigation.live", id: "flag_live" }
];

const toBool = (value: any): boolean => {
  return value === 1 || value === "1" || value === true || value === "true";
};

const normalizeEnabledValue = (value: number | boolean | string | null | undefined): boolean => {
  if (value === null || value === undefined) {
    return true;
  }

  return toBool(value);
};

export const MobileConfigRepository = {
  /**
   * Get the complete mobile navigation config.
   */
  getNavigationConfig(): MobileNavigationConfig {
    const db = getDatabase();
    const rows = db
      .prepare(`SELECT feature_key, enabled FROM mobile_feature_flags WHERE feature_key LIKE 'navigation.%' ORDER BY feature_key`)
      .all() as Array<{ feature_key: string; enabled: number | string | boolean | null }>;

    const config: MobileNavigationConfig = {
      liveScores: true,
      sports: true,
      live: true
    };

    for (const row of rows) {
      const enabled = normalizeEnabledValue(row.enabled);
      if (row.feature_key === "navigation.liveScores") {
        config.liveScores = enabled;
      } else if (row.feature_key === "navigation.sports") {
        config.sports = enabled;
      } else if (row.feature_key === "navigation.live") {
        config.live = enabled;
      }
    }

    return config;
  },

  /**
   * Update navigation feature flags.
   * Only fields provided in the update will be modified.
   */
  updateNavigationConfig(update: Partial<MobileNavigationConfig>): MobileNavigationConfig {
    const db = getDatabase();
    const now = new Date().toISOString();

    const updateOrInsertFeature = (featureKey: string, enabled: boolean) => {
      const result = db
        .prepare(`UPDATE mobile_feature_flags SET enabled = ?, updated_at = ? WHERE feature_key = ?`)
        .run(enabled ? 1 : 0, now, featureKey);

      if (result.changes === 0) {
        const id = DEFAULT_FEATURES.find((item) => item.feature_key === featureKey)?.id ?? crypto.randomUUID();
        db.prepare(
          `INSERT INTO mobile_feature_flags (id, feature_key, enabled, display_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(id, featureKey, enabled ? 1 : 0, null, now, now);
      }
    };

    if (update.liveScores !== undefined) {
      updateOrInsertFeature("navigation.liveScores", update.liveScores);
    }

    if (update.sports !== undefined) {
      updateOrInsertFeature("navigation.sports", update.sports);
    }

    if (update.live !== undefined) {
      updateOrInsertFeature("navigation.live", update.live);
    }

    return this.getNavigationConfig();
  },

  /**
   * Get a specific feature by name.
   */
  getFeature(featureName: string): MobileFeature | null {
    const db = getDatabase();
    const row = db
      .prepare(`SELECT id, feature_key AS feature_name, enabled, created_at, updated_at FROM mobile_feature_flags WHERE feature_key = ?`)
      .get(featureName) as MobileFeature | undefined;

    return row ?? null;
  },

  /**
   * Get all mobile features.
   */
  getAllFeatures(): MobileFeature[] {
    const db = getDatabase();
    return db
      .prepare(`SELECT id, feature_key AS feature_name, enabled, created_at, updated_at FROM mobile_feature_flags ORDER BY feature_key`)
      .all() as MobileFeature[];
  }
};
