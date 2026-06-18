export const matchLifecycleStates = [
  "draft",
  "scheduled",
  "assigned",
  "approved",
  "published",
  "live",
  "ended",
  "cancelled"
] as const;

export type MatchLifecycleStatus = (typeof matchLifecycleStates)[number];

export const streamLifecycleStates = [
  "idle",
  "assigned",
  "testing",
  "approved",
  "active",
  "failed",
  "disabled"
] as const;

export type StreamLifecycleStatus = (typeof streamLifecycleStates)[number];

export const matchLifecycleTransitions: Record<MatchLifecycleStatus, MatchLifecycleStatus[]> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["assigned", "cancelled"],
  assigned: ["approved", "cancelled"],
  approved: ["published", "cancelled"],
  published: ["live", "cancelled"],
  live: ["ended"],
  ended: [],
  cancelled: []
};

export const streamLifecycleTransitions: Record<StreamLifecycleStatus, StreamLifecycleStatus[]> = {
  idle: ["assigned", "disabled"],
  assigned: ["testing", "approved", "failed", "disabled"],
  testing: ["approved", "failed", "disabled"],
  approved: ["active", "failed", "disabled"],
  active: ["failed", "disabled"],
  failed: ["testing", "disabled"],
  disabled: []
};

export function canTransitionMatch(
  from: MatchLifecycleStatus,
  to: MatchLifecycleStatus
): boolean {
  return matchLifecycleTransitions[from].includes(to);
}

export function canTransitionStream(
  from: StreamLifecycleStatus,
  to: StreamLifecycleStatus
): boolean {
  return streamLifecycleTransitions[from].includes(to);
}
