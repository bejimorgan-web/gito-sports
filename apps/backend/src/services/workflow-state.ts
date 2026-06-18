import type { MatchLifecycleStatus, StreamLifecycleStatus } from "@gito/shared";
import { canTransitionMatch, canTransitionStream } from "@gito/shared";

export class WorkflowStateError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 409
  ) {
    super(message);
  }
}

export function assertMatchTransition(
  currentStatus: MatchLifecycleStatus,
  nextStatus: MatchLifecycleStatus
) {
  if (!canTransitionMatch(currentStatus, nextStatus)) {
    throw new WorkflowStateError(
      `Cannot transition match from ${currentStatus} to ${nextStatus}.`,
      "invalid_match_state_transition"
    );
  }
}

export function assertStreamTransition(
  currentStatus: StreamLifecycleStatus,
  nextStatus: StreamLifecycleStatus
) {
  if (!canTransitionStream(currentStatus, nextStatus)) {
    throw new WorkflowStateError(
      `Cannot transition stream from ${currentStatus} to ${nextStatus}.`,
      "invalid_stream_state_transition"
    );
  }
}
