import type { Request } from "express";
import type { Competition, Country, Sport, Team } from "@gito/shared";

function normalizeAssetUrl(request: Request, value: string) {
  if (value.startsWith("/uploads/")) {
    return `${request.protocol}://${request.get("host")}${value}`;
  }

  return value;
}

export function normalizeSport(request: Request, sport: Sport): Sport {
  if (!sport.logoUrl) {
    return sport;
  }

  const normalizedSport: Sport = {
    ...sport,
    logoUrl: normalizeAssetUrl(request, sport.logoUrl)
  };

  return normalizedSport;
}

export function normalizeCountry(request: Request, country: Country): Country {
  if (!country.flagUrl) {
    return country;
  }

  const normalizedCountry: Country = {
    ...country,
    flagUrl: normalizeAssetUrl(request, country.flagUrl)
  };

  return normalizedCountry;
}

export function normalizeCompetition(request: Request, competition: Competition): Competition {
  if (!competition.logoUrl) {
    return competition;
  }

  const normalizedCompetition: Competition = {
    ...competition,
    logoUrl: normalizeAssetUrl(request, competition.logoUrl)
  };

  return normalizedCompetition;
}

export function normalizeTeam(request: Request, team: Team): Team {
  if (!team.logoUrl) {
    return team;
  }

  const normalizedTeam: Team = {
    ...team,
    logoUrl: normalizeAssetUrl(request, team.logoUrl)
  };

  return normalizedTeam;
}
