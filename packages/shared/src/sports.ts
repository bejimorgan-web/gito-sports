import type { EntityId, EntityStatus } from "./naming";
import type { MatchLifecycleStatus } from "./lifecycle";

export type RegionType = "country" | "continent" | "international" | "custom";

export type CompetitionScope =
  | "domestic"
  | "continental"
  | "international"
  | "friendly"
  | "custom";

export type CompetitionType = "league" | "cup" | "tournament" | "friendly" | "custom";

export type CompetitionParticipantType = "clubs" | "nationalTeams";

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

export interface Season {
  id: EntityId;
  competitionId: EntityId;
  name: string;
  startsAt?: string;
  endsAt?: string;
  status: EntityStatus;
}

export interface Competition {
  id: EntityId;
  sportId: EntityId;
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
  type: TeamType;
  logoUrl?: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Match {
  id: EntityId;
  competitionId: EntityId;
  seasonId?: EntityId;
  homeTeamId: EntityId;
  awayTeamId: EntityId;
  startsAt: string;
  venueName?: string;
  status: MatchStatus;
  createdAt: string;
  updatedAt: string;
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
  type: TeamType;
  logoUrl?: string;
}

export interface UpdateTeamRequest {
  sportId?: EntityId;
  countryId?: EntityId;
  name?: string;
  shortName?: string;
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
