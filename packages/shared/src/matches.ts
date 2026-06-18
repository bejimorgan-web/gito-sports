export type MatchLifecycleStatus =
  | "scheduled"
  | "live"
  | "paused"
  | "ended"
  | "cancelled";

export interface Match {
  id: string;
  title: string;
  sportId?: string;
  competitionId?: string;
  status?: MatchLifecycleStatus;
}

export interface PublishedLiveMatch extends Match {
  streamId?: string;
}