export const soccerCompetitionFormats = [
  { id: "domestic_league", name: "Domestic League", description: "One league table with single or double round-robin scheduling." },
  { id: "league_phase_knockout", name: "League Phase + Knockout", description: "One overall league table determines progression to knockout stages." },
  { id: "groups_only", name: "Groups Only", description: "Separate group tables, without a required knockout stage." },
  { id: "groups_knockout", name: "Groups + Knockout", description: "Group standings determine entry to a knockout bracket." },
  { id: "single_match_knockout", name: "Single-Match Knockout", description: "Each knockout tie is decided by one configured match." },
  { id: "two_legged_knockout", name: "Two-Legged Knockout", description: "Each tie has two legs and explicitly configured aggregate resolution." },
  { id: "league_playoffs", name: "League + Playoffs", description: "A league phase is followed by playoffs for a configured outcome." },
  { id: "custom_multi_stage", name: "Custom / Multi-Stage", description: "Combine configured stages when a single template does not fit." }
] as const;

export type SoccerCompetitionFormatId = typeof soccerCompetitionFormats[number]["id"];
export type SoccerStageKind = "league" | "groups" | "knockout";
export interface SoccerTieBreaker { criterion: string; direction: "asc" | "desc"; }
export interface SoccerStageRules {
  id: string;
  name: string;
  kind: SoccerStageKind;
  scheduling?: "single_round_robin" | "double_round_robin";
  groupCount?: number;
  points?: { win: number; draw: number; loss: number };
  tieBreakers?: SoccerTieBreaker[];
  qualification?: { places?: number[]; condition?: string };
  tieResolution?: {
    legs: 1 | 2;
    aggregateGoals: boolean;
    awayGoals: "not_used" | "used";
    extraTime: boolean;
    penalties: boolean;
    unresolved: "incomplete" | "replay" | "administrator_decision";
  };
  progression?: { winnerStageId: string; loserStageId?: string };
}
export interface SoccerQualificationRoute {
  id: string;
  source: { type: "final_position" | "champion" | "cup_winner" | "playoff"; positions?: number[] };
  destinationCompetitionId: string;
  destinationSeasonId: string;
  destinationStageId: string;
  slots: number;
  duplicatePolicy: "deduplicate" | "allow";
  vacancyPolicy: "leave_vacant" | "configured_route";
  replacementRouteId?: string;
  eligibility: string[];
}
export interface SoccerCompetitionRuleset {
  formatTemplateId: SoccerCompetitionFormatId;
  sport: "soccer";
  stages: SoccerStageRules[];
  qualificationRoutes: SoccerQualificationRoute[];
}
