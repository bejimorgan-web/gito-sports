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

const toBool = (value: any): boolean => {
  return value === 1 || value === "1" || value === true || value === "true";
};

export const MobileConfigRepository = {
  /**
   * Get the complete mobile navigation config.
   */
  getNavigationConfig(): MobileNavigationConfig {
    const db = getDatabase();
    const rows = db
      .prepare(`SELECT feature_name, enabled FROM mobile_features WHERE feature_name LIKE 'navigation.%'`)
      .all() as Array<{ feature_name: string; enabled: number | string | boolean }>;

    const config: MobileNavigationConfig = {
      liveScores: true,
      sports: true,
      live: true
    };

    for (const row of rows) {
      const enabled = toBool(row.enabled);
      if (row.feature_name === "navigation.liveScores") {
        config.liveScores = enabled;
      } else if (row.feature_name === "navigation.sports") {
        config.sports = enabled;
      } else if (row.feature_name === "navigation.live") {
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

    if (update.liveScores !== undefined) {
      db.prepare(
        `UPDATE mobile_features SET enabled = ?, updated_at = ? WHERE feature_name = 'navigation.liveScores'`
      ).run(update.liveScores ? 1 : 0, now);
    }

    if (update.sports !== undefined) {
      db.prepare(
        `UPDATE mobile_features SET enabled = ?, updated_at = ? WHERE feature_name = 'navigation.sports'`
      ).run(update.sports ? 1 : 0, now);
    }

    if (update.live !== undefined) {
      db.prepare(
        `UPDATE mobile_features SET enabled = ?, updated_at = ? WHERE feature_name = 'navigation.live'`
      ).run(update.live ? 1 : 0, now);
    }

    return this.getNavigationConfig();
  },

  /**
   * Get a specific feature by name.
   */
  getFeature(featureName: string): MobileFeature | null {
    const db = getDatabase();
    const row = db
      .prepare(`SELECT id, feature_name, enabled, created_at, updated_at FROM mobile_features WHERE feature_name = ?`)
      .get(featureName) as MobileFeature | undefined;

    return row ?? null;
  },

  /**
   * Get all mobile features.
   */
  getAllFeatures(): MobileFeature[] {
    const db = getDatabase();
    return db
      .prepare(`SELECT id, feature_name, enabled, created_at, updated_at FROM mobile_features ORDER BY feature_name`)
      .all() as MobileFeature[];
  }
};
