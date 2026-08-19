import type { EntityId } from "./naming.js";

export interface MobileClub {
  id: EntityId;
  name: string;
  shortName?: string;
  slug?: string;
  logoUrl?: string;
  sportId: EntityId;
  countryId?: EntityId;
  type: string;
  status: string;
  sport: { id: EntityId; name: string };
  country: { id: EntityId; name: string } | null;
}

export interface MobileSeason {
  id: EntityId;
  competitionId: EntityId;
  name: string;
  startsAt?: string;
  endsAt?: string;
  status: string;
}

export interface MobileStream {
  id: EntityId;
  matchId: EntityId;
  channelId: EntityId;
  channelName: string;
  providerId: EntityId;
  providerName: string;
  status: string;
  approvalStatus: string;
  healthStatus: string;
}

export interface MobileFixture {
  id: EntityId;
  startsAt: string;
  status: string;
  venue: string | null;
  competition: { id: EntityId; name: string; slug: string };
  season: { id: EntityId; name: string } | null;
  sport: { id: EntityId; name: string } | null;
  country: { id: EntityId; name: string } | null;
  homeClub: MobileClub;
  awayClub: MobileClub;
  score: null;
  live: boolean;
  streams: MobileStream[];
}

export interface MobileClubDetail {
  club: MobileClub;
  competitions: unknown[];
  seasons: MobileSeason[];
  nextFixture: MobileFixture | null;
  previousResult: MobileFixture | null;
}
