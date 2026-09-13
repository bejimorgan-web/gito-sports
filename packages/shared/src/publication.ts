import type { EntityId } from "./naming.js";

export type PublicationCapability = "live";
export type PublicationStatus = "draft" | "approved" | "published" | "revoked" | "unavailable";
export type PublicationAvailability = "ready" | "degraded" | "offline" | "unknown";

export interface PublicationArtifact {
  schemaVersion: number;
  publicationId: EntityId;
  matchId: EntityId;
  sourceReference: string;
  capability: PublicationCapability;
  publicationStatus: PublicationStatus;
  availability: PublicationAvailability;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  revokedAt: string | null;
}

export type PublicationArtifactSubmission = Pick<
  PublicationArtifact,
  | "schemaVersion"
  | "publicationId"
  | "matchId"
  | "sourceReference"
  | "capability"
  | "publicationStatus"
  | "availability"
  | "expiresAt"
>;
