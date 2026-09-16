import { Router } from "express";
import type { PublicationArtifactSubmission } from "@gito/shared";
import { protectedRoute } from "../middleware/protected.js";
import {
  approvePublicationArtifact,
  bindPublicationArtifact,
  createPublicationArtifact,
  getPublicationArtifactById,
  setPublicationDelivery
  , listPublishedPublicationFeed
} from "../repositories/publication-artifact-repository.js";
import { revokePublicationArtifact, publishPublicationArtifact, updatePublicationArtifact } from "../repositories/publication-artifact-repository.js";
import {
  PUBLICATION_ARTIFACT_SCHEMA_VERSION,
  PublicationArtifactValidationError,
  assertPublicationAvailability,
  assertPublicationCapability,
  assertPublicationStatus,
  assertPublicationPlaybackMode
} from "../services/publication-artifact.js";

const allowedFields = new Set<keyof PublicationArtifactSubmission>([
  "schemaVersion",
  "publicationId",
  "matchId",
  "sourceReference",
  "capability",
  "publicationStatus",
  "availability",
  "expiresAt"
]);

function parseSubmission(body: unknown): PublicationArtifactSubmission {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("publication_request_object_required");
  }

  const input = body as Record<string, unknown>;
  const unexpected = Object.keys(input).filter((key) => !allowedFields.has(key as keyof PublicationArtifactSubmission));
  if (unexpected.length > 0) {
    throw new Error(`publication_request_field_not_allowed:${unexpected[0]}`);
  }

  if (input.schemaVersion !== PUBLICATION_ARTIFACT_SCHEMA_VERSION) throw new Error("publication_schema_version_invalid");
  if (typeof input.publicationId !== "string" || !/^publication_[A-Za-z0-9._:-]+$/.test(input.publicationId)) throw new Error("publication_id_invalid");
  if (typeof input.matchId !== "string" || !input.matchId.trim()) throw new Error("publication_match_id_required");
  if (typeof input.sourceReference !== "string") throw new Error("publication_source_reference_required");
  if (input.expiresAt !== null && input.expiresAt !== undefined && typeof input.expiresAt !== "string") throw new Error("publication_expiry_invalid");

  assertPublicationCapability(input.capability);
  assertPublicationStatus(input.publicationStatus);
  assertPublicationAvailability(input.availability);

  return {
    schemaVersion: input.schemaVersion,
    publicationId: input.publicationId,
    matchId: input.matchId,
    sourceReference: input.sourceReference,
    capability: input.capability,
    publicationStatus: input.publicationStatus,
    availability: input.availability,
    expiresAt: input.expiresAt === undefined ? null : input.expiresAt
  };
}

export const publicationArtifactsRouter = Router();

publicationArtifactsRouter.get("/published", protectedRoute, (_request, response) => {
  response.json({ data: listPublishedPublicationFeed() });
});

publicationArtifactsRouter.post("/", protectedRoute, (request, response) => {
  try {
    const submission = parseSubmission(request.body);
    const artifact = createPublicationArtifact(submission);
    response.status(201).json({ data: artifact });
  } catch (error) {
    if (error instanceof PublicationArtifactValidationError) {
      response.status(400).json({ error: error.code, message: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    const knownBadRequest = message.startsWith("publication_");
    response.status(knownBadRequest ? (message === "publication_match_not_found" ? 404 : 400) : 500).json({
      error: message
    });
  }
});

publicationArtifactsRouter.get("/:publicationId", protectedRoute, (request, response) => {
  const publicationId = request.params.publicationId;
  if (!publicationId) {
    response.status(400).json({ error: "publication_id_required" });
    return;
  }
  const artifact = getPublicationArtifactById(publicationId);
  if (!artifact) {
    response.status(404).json({ error: "publication_artifact_not_found" });
    return;
  }
  response.json({ data: artifact });
});

publicationArtifactsRouter.post("/:publicationId/bind", protectedRoute, (request, response) => {
  try {
    const publicationId = request.params.publicationId;
    if (!publicationId) {
      response.status(400).json({ error: "publication_id_required" });
      return;
    }
    const body = request.body as Record<string, unknown>;
    const keys = Object.keys(body ?? {});
    if (keys.some((key) => key !== "matchId")) {
      response.status(400).json({ error: "publication_binding_field_not_allowed" });
      return;
    }
    if (typeof body?.matchId !== "string" || !body.matchId.trim()) {
      response.status(400).json({ error: "publication_match_id_required" });
      return;
    }
    const artifact = bindPublicationArtifact(publicationId, body.matchId);
    if (!artifact) {
      response.status(404).json({ error: "publication_artifact_not_found" });
      return;
    }
    response.json({ data: artifact });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.status(message === "publication_match_conflict" ? 409 : 400).json({ error: message });
  }
});

publicationArtifactsRouter.post("/:publicationId/delivery", protectedRoute, (request, response) => {
  const publicationId = request.params.publicationId;
  const body = request.body as Record<string, unknown>;
  if (!publicationId) { response.status(400).json({ error: "publication_id_required" }); return; }
  if (Object.keys(body ?? {}).some((key) => !["deliveryReference", "playbackUrl", "playbackMode"].includes(key))) { response.status(400).json({ error: "publication_delivery_field_not_allowed" }); return; }
  if (typeof body.deliveryReference !== "string" || typeof body.playbackUrl !== "string") { response.status(400).json({ error: "publication_delivery_fields_required" }); return; }
  try {
    assertPublicationPlaybackMode(body.playbackMode ?? "DIRECT_SAFE");
    const artifact = setPublicationDelivery(publicationId, { deliveryReference: body.deliveryReference, playbackUrl: body.playbackUrl, playbackMode: body.playbackMode as "DIRECT_SAFE" | "DIRECT_XTREAM" });
    if (!artifact) { response.status(404).json({ error: "publication_artifact_not_found" }); return; }
    response.json({ data: artifact });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

publicationArtifactsRouter.post("/:publicationId/publish", protectedRoute, (request, response) => {
  const publicationId = request.params.publicationId;
  if (!publicationId) {
    response.status(400).json({ error: "publication_id_required" });
    return;
  }
  if (Object.keys(request.body ?? {}).length > 0) {
    response.status(400).json({ error: "publication_publish_body_not_allowed" });
    return;
  }
  try {
    const artifact = publishPublicationArtifact(publicationId);
    if (!artifact) {
      response.status(404).json({ error: "publication_artifact_not_found" });
      return;
    }
    response.json({ data: artifact });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

publicationArtifactsRouter.post("/:publicationId/approve", protectedRoute, (request, response) => {
  const publicationId = request.params.publicationId;
  if (!publicationId) {
    response.status(400).json({ error: "publication_id_required" });
    return;
  }
  if (Object.keys(request.body ?? {}).length > 0) {
    response.status(400).json({ error: "publication_approve_body_not_allowed" });
    return;
  }
  try {
    const artifact = approvePublicationArtifact(publicationId);
    if (!artifact) {
      response.status(404).json({ error: "publication_artifact_not_found" });
      return;
    }
    response.json({ data: artifact });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

publicationArtifactsRouter.post("/:publicationId/revoke", protectedRoute, (request, response) => {
  const publicationId = request.params.publicationId;
  if (!publicationId) {
    response.status(400).json({ error: "publication_id_required" });
    return;
  }
  if (Object.keys(request.body ?? {}).length > 0) {
    response.status(400).json({ error: "publication_revoke_body_not_allowed" });
    return;
  }
  const artifact = revokePublicationArtifact(publicationId);
  if (!artifact) {
    response.status(404).json({ error: "publication_artifact_not_found" });
    return;
  }
  response.json({ data: artifact });
});

publicationArtifactsRouter.post("/:publicationId/availability", protectedRoute, (request, response) => {
  const publicationId = request.params.publicationId;
  if (!publicationId) {
    response.status(400).json({ error: "publication_id_required" });
    return;
  }
  const body = request.body as Record<string, unknown>;
  const keys = Object.keys(body ?? {});
  if (keys.some((key) => key !== "availability" && key !== "expiresAt")) {
    response.status(400).json({ error: "publication_availability_field_not_allowed" });
    return;
  }
  if (typeof body?.availability !== "string") {
    response.status(400).json({ error: "publication_availability_required" });
    return;
  }
  if (body.expiresAt !== undefined && body.expiresAt !== null && typeof body.expiresAt !== "string") {
    response.status(400).json({ error: "publication_expiry_invalid" });
    return;
  }
  try {
    const artifact = updatePublicationArtifact(publicationId, {
      availability: body.availability as Parameters<typeof updatePublicationArtifact>[1]["availability"],
      ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt as string | null } : {})
    });
    if (!artifact) {
      response.status(404).json({ error: "publication_artifact_not_found" });
      return;
    }
    response.json({ data: artifact });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});
