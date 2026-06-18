import { Router } from "express";

import type { AuthenticatedRequest } from "../middleware/protected.js";
import { protectedRoute } from "../middleware/protected.js";
import { requireStreamTransition } from "../middleware/transition-guards.js";
import { WorkflowStateError } from "../services/workflow-state.js";
import { StreamService } from "../services/stream-service.js";

export const streamsRouter = Router();

streamsRouter.get("/", (_request, response) => {
  response.json({
    data: StreamService.listStreams()
  });
});

streamsRouter.post("/:streamId/approve", protectedRoute, requireStreamTransition("approved"), (request, response) => {
  const streamId = request.params.streamId;

  if (!streamId) {
    response.status(400).json({ error: "stream_id_required" });
    return;
  }

  const operatorId = (request as AuthenticatedRequest).operator?.id ?? "local-operator";
  const stream = StreamService.approveStream(streamId, operatorId);

  if (!stream) {
    response.status(404).json({ error: "stream_not_found" });
    return;
  }

  response.json({ data: stream });
});

streamsRouter.post("/:streamId/publish", protectedRoute, requireStreamTransition("active"), (request, response) => {
  const streamId = request.params.streamId;

  if (!streamId) {
    response.status(400).json({ error: "stream_id_required" });
    return;
  }

  const stream = StreamService.publishStream(streamId);

  if (!stream) {
    response.status(409).json({ error: "stream_must_be_approved_before_publish" });
    return;
  }

  response.json({ data: stream });
});

streamsRouter.post("/:streamId/reassign", protectedRoute, async (request, response) => {
  const streamId = request.params.streamId;
  const { channelId } = request.body as { channelId?: string };

  if (!streamId) {
    response.status(400).json({ error: "stream_id_required" });
    return;
  }

  if (!channelId) {
    response.status(400).json({ error: "channel_id_required" });
    return;
  }

  try {
    const stream = StreamService.reassignStream(streamId, channelId);

    if (!stream) {
      response.status(404).json({ error: "stream_not_found" });
      return;
    }

    response.json({ data: stream });
  } catch (error) {
    if (error instanceof WorkflowStateError) {
      response.status(error.statusCode ?? 400).json({ error: error.code ?? "stream_reassign_failed", message: error.message });
      return;
    }

    throw error;
  }
});

streamsRouter.delete("/:streamId", protectedRoute, (request, response) => {
  const streamId = request.params.streamId;

  if (!streamId) {
    response.status(400).json({ error: "stream_id_required" });
    return;
  }

  if (!StreamService.deleteStream(streamId)) {
    response.status(404).json({ error: "stream_not_found" });
    return;
  }

  response.status(204).send();
});

streamsRouter.post("/:streamId/health", (request, response) => {
  const streamId = request.params.streamId;
  const { status, reason } = request.body as { status?: string; reason?: string };

  if (!streamId) {
    response.status(400).json({ error: "stream_id_required" });
    return;
  }

  if (!status || !["active", "degraded", "failed", "unknown"].includes(status)) {
    response.status(400).json({ error: "valid_stream_health_status_required" });
    return;
  }

  const stream = StreamService.reportHealth(streamId, {
    status: status as "active" | "degraded" | "failed" | "unknown",
    ...(reason ? { reason } : {})
  });

  if (!stream) {
    response.status(404).json({ error: "stream_not_found" });
    return;
  }

  response.json({ data: stream });
});
