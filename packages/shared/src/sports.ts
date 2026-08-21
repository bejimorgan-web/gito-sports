import type { EntityId, EntityStatus } from "./naming.js";
import type { MatchLifecycleStatus } from "./lifecycle.js";

export type RegionType = "country" | "continent" | "international" | "custom";

export type CompetitionScope =
  | "domestic"
  | "continental"
  | "international"
  | "global"
  | "regional"
  | "friendly"
  | "custom";

export type CompetitionType = "league" | "cup" | "tournament" | "championship" | "friendly" | "custom";

export type CompetitionParticipantType = "clubs" | "nationalTeams";

export type HostType = "country" | "organization" | "federation" | "association" | "regional" | "international" | "other";

export type TeamType = "club" | "national" | "custom";

export type MatchStatus = MatchLifecycleStatus;

export interface Sport {
  id: EntityId;
  name: string;
  slug: string;
  logoUrl?: string;
  countryIds?: EntityId[];
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Country {
  id: EntityId;
  name: string;
  iso2Code: string;
  iso3Code: string;
  regionId?: EntityId;
  flagUrl?: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Host {
  id: EntityId;
  sportId: EntityId;
  name: string;
  type: HostType;
  countryId?: EntityId;
  logoUrl?: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Season {
  id: EntityId;
  competitionId: EntityId;
  name: string;
  startsAt?: string;
  endsAt?: string;
  status: EntityStatus;
}

export interface CreateSeasonRequest {
  name: string;
  startsAt?: string | null;
  endsAt?: string | null;
}

export interface UpdateSeasonRequest {
  name?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  status?: EntityStatus;
}

export interface Competition {
  id: EntityId;
  sportId: EntityId;
  hostId?: EntityId;
  countryId?: EntityId;
  regionId?: EntityId;
  name: string;
  slug: string;
  scope: CompetitionScope;
  type: CompetitionType;
  participantType: CompetitionParticipantType;
  currentSeasonId?: EntityId;
  logoUrl?: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Team {
  id: EntityId;
  sportId: EntityId;
  countryId?: EntityId;
  name: string;
  shortName?: string;
  slug?: string;
  type: TeamType;
  logoUrl?: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CompetitionSeasonTeam {
  id: EntityId;
  competitionId: EntityId;
  seasonId: EntityId;
  teamId: EntityId;
  membershipStatus: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ClubDetail extends Team {
  country?: Country;
  sport?: Sport;
  competitions: Competition[];
  seasons: Season[];
}

export interface Match {
  id: EntityId;
  competitionId: EntityId;
  seasonId?: EntityId;
  homeTeamId: EntityId;
  awayTeamId: EntityId;
  startsAt: string;
  venueName?: string;
  externalProvider?: string;
  externalMatchId?: string;
  status: MatchStatus;
  createdAt: string;
  updatedAt: string;
}

export type FixtureLinkStatus = "linked" | "ambiguous" | "unresolved" | "rejected";
export type FixtureConfidence = "high" | "medium" | "low";

export interface FixtureReconciliationCandidate {
  matchId: EntityId;
  confidence: FixtureConfidence;
  reasons: string[];
}

export interface FixtureReconciliationDecision {
  schedulingMatchId: EntityId;
  candidateMatchIds: EntityId[];
  selectedMatchId?: EntityId;
  confidence: FixtureConfidence;
  linkStatus: FixtureLinkStatus;
  reasons: string[];
  candidates: FixtureReconciliationCandidate[];
}

export interface FixtureReconciliationPreview {
  decisions: FixtureReconciliationDecision[];
  summary: { total: number; highConfidence: number; mediumConfidence: number; lowConfidence: number; linked: number; unresolved: number; ambiguous: number };
}

export interface CreateSportRequest {
  name: string;
  logoUrl?: string;
  countryIds?: EntityId[];
}

export interface UpdateSportRequest {
  name?: string;
  logoUrl?: string;
  countryIds?: EntityId[];
  status?: EntityStatus;
}

export interface CreateCountryRequest {
  name: string;
  iso2Code: string;
  iso3Code: string;
  regionId?: EntityId;
  flagUrl?: string;
}

export interface CreateHostRequest {
  sportId: EntityId;
  name: string;
  type?: HostType;
  hostType?: HostType;
  countryId?: EntityId;
  logoUrl?: string;
}

export interface UpdateHostRequest {
  name?: string;
  type?: HostType;
  hostType?: HostType;
  countryId?: EntityId | null;
  logoUrl?: string | null;
  status?: EntityStatus;
}

export interface UpdateCountryRequest {
  name?: string;
  iso2Code?: string;
  iso3Code?: string;
  regionId?: EntityId;
  flagUrl?: string;
  status?: EntityStatus;
}

export interface CreateCompetitionRequest {
  sportId: EntityId;
  hostId?: EntityId;
  countryId?: EntityId;
  regionId?: EntityId;
  name: string;
  scope: CompetitionScope;
  type: CompetitionType;
  participantType?: CompetitionParticipantType;
  currentSeasonId?: EntityId;
  logoUrl?: string;
}

export interface UpdateCompetitionRequest {
  sportId?: EntityId;
  hostId?: EntityId | null;
  countryId?: EntityId;
  regionId?: EntityId;
  name?: string;
  scope?: CompetitionScope;
  type?: CompetitionType;
  participantType?: CompetitionParticipantType;
  currentSeasonId?: EntityId;
  logoUrl?: string;
  status?: EntityStatus;
}

export interface CreateTeamRequest {
  sportId: EntityId;
  countryId?: EntityId;
  name: string;
  shortName?: string;
  slug?: string;
  type: TeamType;
  logoUrl?: string;
}

export interface UpdateTeamRequest {
  sportId?: EntityId;
  countryId?: EntityId;
  name?: string;
  shortName?: string;
  slug?: string;
  type?: TeamType;
  logoUrl?: string;
  status?: EntityStatus;
}

export interface CreateMatchRequest {
  competitionId: EntityId;
  homeTeamId: EntityId;
  awayTeamId: EntityId;
  kickoffTime: string;
  countryId?: EntityId;
  sportId?: EntityId;
}

export interface UpdateMatchRequest {
  kickoffTime?: string;
  status?: MatchStatus;
}
