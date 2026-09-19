import type { PublicationAvailability, PublicationCapability, PublicationStatus } from "@gito/shared";
import type { PublicationPlaybackMode } from "@gito/shared";

export const PUBLICATION_ARTIFACT_SCHEMA_VERSION = 1;

export class PublicationArtifactValidationError extends Error {
  readonly code = "publication_source_reference_unsafe";

  constructor(message = "Publication sourceReference must be an opaque, provider-neutral reference.") {
    super(message);
    this.name = "PublicationArtifactValidationError";
  }
}

export function validatePublicationSourceReference(value: unknown): string {
  if (typeof value !== "string") {
    throw new PublicationArtifactValidationError();
  }

  const reference = value.trim();
  if (!reference || reference.length > 512 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(reference)) {
    throw new PublicationArtifactValidationError();
  }

  if (/(?:username|password|credential|token|api[_-]?key|\.m3u8?|\/live\/|\/movie\/|\/series\/)/i.test(reference)) {
    throw new PublicationArtifactValidationError();
  }

  if (reference.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(reference)) {
    try {
      const decoded = Buffer.from(reference, "base64").toString("utf8");
      if (/(?:https?:\/\/|username|password|credential|token|\/live\/|\/movie\/|\/series\/|\.m3u8?)/i.test(decoded)) {
        throw new PublicationArtifactValidationError();
      }
    } catch (error) {
      if (error instanceof PublicationArtifactValidationError) throw error;
    }
  }

  return reference;
}

export function assertPublicationCapability(value: unknown): asserts value is PublicationCapability {
  if (value !== "live") throw new Error("publication_capability_unsupported");
}

export function assertPublicationStatus(value: unknown): asserts value is PublicationStatus {
  if (!(["draft", "approved", "published", "revoked", "unavailable"] as const).includes(value as PublicationStatus)) {
    throw new Error("publication_status_invalid");
  }
}

export function assertPublicationAvailability(value: unknown): asserts value is PublicationAvailability {
  if (!( ["ready", "degraded", "offline", "unknown"] as const).includes(value as PublicationAvailability)) {
    throw new Error("publication_availability_invalid");
  }
}

export function assertPublicationPlaybackMode(value: unknown): asserts value is PublicationPlaybackMode {
  if (value !== "DIRECT_SAFE" && value !== "DIRECT_XTREAM") throw new Error("publication_playback_mode_invalid");
}

export function validatePublicationDeliveryUrl(value: string, mode: PublicationPlaybackMode): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("publication_delivery_url_invalid"); }
  if (mode === "DIRECT_SAFE" && url.protocol !== "https:") throw new Error("publication_delivery_url_unsafe");
  if (mode === "DIRECT_XTREAM" && url.protocol !== "http:" && url.protocol !== "https:") throw new Error("publication_delivery_url_unsafe");
  if (url.username || url.password) throw new Error("publication_delivery_url_unsafe");
  for (const key of ["token", "key", "password", "secret", "auth", "user"]) {
    if (url.searchParams.has(key)) throw new Error("publication_delivery_url_unsafe");
  }

  const pathSegments = url.pathname.split("/").filter(Boolean);
  const mediaKind = pathSegments[0]?.toLowerCase();

  if (mode === "DIRECT_SAFE") {
    if (["live", "movie", "series"].includes(mediaKind ?? "") && pathSegments.length >= 4) {
      throw new Error("publication_delivery_url_unsafe");
    }
  } else {
    if (!["live", "movie", "series"].includes(mediaKind ?? "") || pathSegments.length < 4 || !pathSegments.at(-1)?.includes(".")) {
      throw new Error("publication_delivery_url_unsafe");
    }
  }

  return url.toString();
}

export function assertPublicationStatusTransition(current: PublicationStatus, next: PublicationStatus) {
  if (current === next) return;
  if (current === "revoked") throw new Error("publication_status_terminal");
  if (current === "draft" && (next === "approved" || next === "unavailable")) return;
  if (current === "approved" && (next === "published" || next === "unavailable")) return;
  if (current === "published" && (next === "revoked" || next === "unavailable")) return;
  if (current === "unavailable" && (next === "approved" || next === "published")) return;
  throw new Error(`publication_status_transition_invalid:${current}:${next}`);
}
