export type EntityType = "sport" | "country" | "competition" | "team";

export const allowedDeletes = new Set<EntityType>([
  "sport",
  "country",
  "competition",
  "team"
]);

export const protectedEntities = new Set<EntityType>([
  "sport",
  "country",
  "competition",
  "team"
]);

export const cascadeTargets: Record<EntityType, string[]> = {
  sport: [
    "sport_countries",
    "sport_host_links",
    "sport_competition_links",
    "sport_club_links",
    "sport_national_team_links"
  ],
  country: [
    "sport_countries",
    "sport_host_links",
    "host_competition_links"
  ],
  competition: [
    "competition_teams",
    "competition_club_links",
    "competition_national_team_links",
    "host_competition_links",
    "sport_competition_links",
    "scheduling_matches",
    "match_streams",
    "matches",
    "streams"
  ],
  team: [
    "competition_teams",
    "sport_club_links",
    "sport_national_team_links",
    "competition_club_links",
    "competition_national_team_links",
    "scheduling_matches",
    "match_streams",
    "matches",
    "streams"
  ]
};

export const orphanTargets: Record<EntityType, string[]> = {
  sport: ["competitions", "teams", "scheduling_matches"],
  country: ["competitions", "teams", "scheduling_matches"],
  competition: ["competition_teams", "scheduling_matches", "match_streams", "matches", "streams"],
  team: ["competition_teams", "scheduling_matches", "match_streams", "matches", "streams"]
};
