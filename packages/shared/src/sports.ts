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
  hostId?: EntityId;
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

export type PlayerPosition = "goalkeeper" | "defender" | "midfielder" | "forward" | "winger" | "striker" | "fullback" | "center-back" | "attacking-midfielder" | "defensive-midfielder" | "custom";

export interface Player {
  id: EntityId;
  teamId: EntityId;
  countryId?: EntityId;
  firstName: string;
  lastName: string;
  displayName: string;
  photoUrl?: string;
  position?: PlayerPosition;
  jerseyNumber?: number;
  heightCm?: number;
  weightKg?: number;
  birthDate?: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlayerRequest {
  teamId: EntityId;
  countryId?: EntityId;
  firstName: string;
  lastName: string;
  displayName?: string;
  photoUrl?: string;
  position?: PlayerPosition;
  jerseyNumber?: number;
  heightCm?: number;
  weightKg?: number;
  birthDate?: string;
}

export interface UpdatePlayerRequest {
  teamId?: EntityId;
  countryId?: EntityId | null;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  photoUrl?: string | null;
  position?: PlayerPosition;
  jerseyNumber?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  birthDate?: string | null;
  status?: EntityStatus;
}

export interface SeasonSquad {
  id: EntityId;
  teamId: EntityId;
  competitionId?: EntityId;
  seasonId?: EntityId;
  name: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSeasonSquadRequest { teamId: EntityId; competitionId?: EntityId; seasonId?: EntityId; name: string; }
export interface UpdateSeasonSquadRequest { teamId?: EntityId; competitionId?: EntityId | null; seasonId?: EntityId | null; name?: string; status?: EntityStatus; }

export interface SquadPlayer {
  id: EntityId;
  squadId: EntityId;
  playerId: EntityId;
  role: "starter" | "bench" | "rotation" | "coach-choice" | "custom";
  position?: string;
  jerseyNumber?: number;
  isCaptain: boolean;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSquadPlayerRequest { squadId: EntityId; playerId: EntityId; role?: SquadPlayer["role"]; position?: string; jerseyNumber?: number; isCaptain?: boolean; }
export interface UpdateSquadPlayerRequest { squadId?: EntityId; playerId?: EntityId; role?: SquadPlayer["role"]; position?: string | null; jerseyNumber?: number | null; isCaptain?: boolean; status?: EntityStatus; }

export interface FormationPositionPoint { x: number; y: number; label?: string; }
export interface FormationTemplate { id: EntityId; sportId: EntityId; name: string; key: string; formation: string; positions: FormationPositionPoint[]; status: EntityStatus; createdAt: string; updatedAt: string; }
export interface CreateFormationTemplateRequest { sportId: EntityId; name: string; key?: string; formation: string; positions: FormationPositionPoint[]; }
export interface UpdateFormationTemplateRequest { sportId?: EntityId; name?: string; key?: string; formation?: string; positions?: FormationPositionPoint[]; status?: EntityStatus; }

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
  hostId?: EntityId;
  countryId?: EntityId;
  name: string;
  shortName?: string;
  slug?: string;
  type: TeamType;
  logoUrl?: string;
}

export interface UpdateTeamRequest {
  sportId?: EntityId;
  hostId?: EntityId;
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
