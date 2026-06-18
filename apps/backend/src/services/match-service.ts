import type { PublishedLiveMatch } from "@gito/shared";

import { assignChannelToMatch, listPublishedLiveMatches, publishApprovedStreamForMatch } from "../repositories/operations-repository";
import { createMatch, deleteMatch, getMatchById, listMatches, updateMatch } from "../repositories/matches-repository";
import { getDatabase } from "../db/connection";

/**
 * Enhanced match data with visibility status.
 * Includes both live matches and those with issues that should still be visible.
 */
export interface EnhancedMatchFeed {
  live: PublishedLiveMatch[];
  summary: {
    liveCount: number;
    totalMatches: number;
    degradationReasons?: Record<string, number>;
  };
}

export const MatchService = {
  listMatches,
  getMatchById,
  createMatch,
  updateMatch,
  deleteMatch,
  assignChannelToMatch,

  /**
   * Get published live matches (core functionality - unchanged)
   * Returns only fully active, healthy matches
   */
  listPublishedLiveMatches(): PublishedLiveMatch[] {
    return listPublishedLiveMatches();
  },

  /**
   * Get enhanced match feed with visibility context
   * Returns live matches plus information about degraded/almost-ready matches
   * Clients can use this for status indicators and warnings
   */
  getEnhancedLiveMatchFeed(): EnhancedMatchFeed {
    const live = listPublishedLiveMatches();
    const liveIds = new Set(live.map(m => m.match.id));

    // Get all published matches with their stream/channel/provider status
    const db = getDatabase();
    const allPublished = db.prepare(`
      SELECT DISTINCT
        m.id, 
        s.id as stream_id,
        s.status as stream_status,
        s.health_status,
        s.published_at,
        c.status as channel_status,
        c.id as channel_id,
        p.status as provider_status,
        p.availability_status,
        p.id as provider_id
      FROM matches m
      LEFT JOIN streams s ON s.match_id = m.id
      LEFT JOIN channels c ON c.id = s.channel_id
      LEFT JOIN providers p ON p.id = c.provider_id
      WHERE m.status = 'published'
      ORDER BY m.starts_at DESC
    `).all() as Array<{
      id: string;
      stream_id: string | null;
      stream_status: string | null;
      health_status: string | null;
      published_at: string | null;
      channel_status: string | null;
      channel_id: string | null;
      provider_status: string | null;
      availability_status: string | null;
      provider_id: string | null;
    }>;

    // Analyze degradation reasons
    const degradationReasons: Record<string, number> = {};
    let totalMatches = 0;

    for (const match of allPublished) {
      if (!liveIds.has(match.id)) {
        totalMatches++;
        
        if (!match.stream_id) {
          degradationReasons["noStream"] = (degradationReasons["noStream"] || 0) + 1;
        } else {
          if (match.stream_status !== "active") {
            degradationReasons["streamNotActive"] = (degradationReasons["streamNotActive"] || 0) + 1;
          }
          if (!match.published_at) {
            degradationReasons["notPublished"] = (degradationReasons["notPublished"] || 0) + 1;
          }
          if (match.health_status === "failed") {
            degradationReasons["healthFailed"] = (degradationReasons["healthFailed"] || 0) + 1;
          }
          if (match.channel_status !== "active" && match.channel_id) {
            degradationReasons["channelInactive"] = (degradationReasons["channelInactive"] || 0) + 1;
          }
          if (match.provider_status !== "active" && match.provider_id) {
            degradationReasons["providerInactive"] = (degradationReasons["providerInactive"] || 0) + 1;
          }
          if (match.availability_status === "offline" && match.provider_id) {
            degradationReasons["providerOffline"] = (degradationReasons["providerOffline"] || 0) + 1;
          }
        }
      }
    }

    return {
      live,
      summary: {
        liveCount: live.length,
        totalMatches: totalMatches + live.length,
        ...(Object.keys(degradationReasons).length > 0 ? { degradationReasons } : {})
      }
    };
  },

  publishApprovedStreamForMatch
};
