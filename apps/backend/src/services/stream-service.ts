import type { Stream } from "@gito/shared";

import {
  approveStream,
  deleteStream,
  publishStream,
  reassignStream,
  reportStreamHealth
} from "../repositories/operations-repository.js";
import { listStreams } from "../repositories/streams-repository.js";

export const StreamService = {
  listStreams(filters?: { matchId?: string }): Stream[] {
    return listStreams(filters);
  },

  approveStream(streamId: string, operatorId: string): Stream | null {
    return approveStream(streamId, operatorId);
  },

  publishStream(streamId: string): Stream | null {
    return publishStream(streamId);
  },

  reassignStream(streamId: string, channelId: string): Stream | null {
    return reassignStream(streamId, channelId);
  },

  deleteStream(streamId: string): boolean {
    return deleteStream(streamId);
  },

  reportHealth(streamId: string, input: { status: Stream["healthStatus"]; reason?: string }): Stream | null {
    return reportStreamHealth(streamId, input);
  }
};
