import type { EntityId } from "./naming.js";
import type { PlayerPosition } from "./sports.js";

export type PlayerImportMode = "create" | "update" | "create-update";
export type PlayerImportRowStatus = "ready" | "warning" | "error";

export interface PlayerImportRow {
  sourceRow: number;
  sourceSheet: string;
  stablePlayerId?: EntityId;
  displayName: string;
  firstName?: string;
  lastName?: string;
  teamId?: EntityId;
  teamName?: string;
  teamShortName?: string;
  competitionId?: EntityId;
  competitionName?: string;
  seasonId?: EntityId;
  seasonName?: string;
  squadId?: EntityId;
  countryId?: EntityId;
  countryName?: string;
  primaryPosition?: PlayerPosition | string;
  secondaryPositions: string[];
  secondaryPositionsProvided?: boolean;
  birthDate?: string;
  heightCm?: number;
  weightKg?: number;
  jerseyNumber?: number;
  photoUrl?: string;
  unmappedColumns: string[];
}

export interface PlayerImportRequest {
  mode: PlayerImportMode;
  defaultCompetitionId?: EntityId;
  defaultSeasonId?: EntityId;
  defaultSquadId?: EntityId;
  sheets?: string[];
  recognizedSheets?: string[];
  unmappedColumns?: string[];
  rows: PlayerImportRow[];
}

export interface PlayerImportPreviewRow extends PlayerImportRow {
  status: PlayerImportRowStatus;
  messages: string[];
  matchedPlayerId?: EntityId;
  matchedTeamId?: EntityId;
  matchedCompetitionId?: EntityId;
  matchedSeasonId?: EntityId;
  matchedSquadId?: EntityId;
}

export interface PlayerImportPreview {
  mode: PlayerImportMode;
  rows: PlayerImportPreviewRow[];
  sheets: string[];
  recognizedSheets: string[];
  unmappedColumns: string[];
  summary: {
    rowsDetected: number;
    ready: number;
    warnings: number;
    errors: number;
    creates: number;
    updates: number;
    unchanged: number;
    clubs: number;
  };
}

export interface PlayerImportResult {
  rowsProcessed: number;
  playersCreated: number;
  playersUpdated: number;
  playersUnchanged: number;
  squadMembershipsCreated: number;
  warnings: string[];
  errors: string[];
}
