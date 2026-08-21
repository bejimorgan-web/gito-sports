import type { Competition, Country, Host, Match, Sport, Team } from "@gito/shared";
import type { NewsArticleCategoryType } from "@gito/shared";

export type NewsCategoryFormRow = {
  id: string;
  categoryType: NewsArticleCategoryType;
  entityId: string;
};

export type NewsCategoryFilterInput = {
  categoryType: NewsArticleCategoryType;
  rows: NewsCategoryFormRow[];
  sports: Pick<Sport, "id" | "name" | "countryIds">[];
  countries: Pick<Country, "id" | "name">[];
  hosts: Pick<Host, "id" | "name" | "sportId" | "type">[];
  competitions: Pick<Competition, "id" | "name" | "sportId">[];
  teams: Pick<Team, "id" | "name" | "sportId" | "countryId">[];
  matches: Pick<Match, "id" | "competitionId" | "homeTeamId" | "awayTeamId">[];
  competitionTeamIds?: Record<string, string[]>;
};

export function getSelectedCategoryEntityId(rows: NewsCategoryFormRow[], categoryType: NewsArticleCategoryType): string | undefined {
  return rows.find((row) => row.categoryType === categoryType)?.entityId || undefined;
}

export function getFilteredCategoryOptions(input: NewsCategoryFilterInput): Array<{ id: string; name: string }> {
  const selectedSportId = getSelectedCategoryEntityId(input.rows, "sport");
  const selectedCompetitionId = getSelectedCategoryEntityId(input.rows, "competition");
  const selectedCountryId = getSelectedCategoryEntityId(input.rows, "country");
  const selectedTeamId = getSelectedCategoryEntityId(input.rows, "team");

  const competitionIdsForSport = new Set(
    input.competitions
      .filter((competition) => !selectedSportId || competition.sportId === selectedSportId)
      .map((competition) => competition.id)
  );

  const competitionTeamIds = new Set(
    selectedCompetitionId && input.competitionTeamIds ? (input.competitionTeamIds[selectedCompetitionId] ?? []) : []
  );

  switch (input.categoryType) {
    case "sport":
      return input.sports.map((sport) => ({ id: sport.id, name: sport.name }));
    case "country": {
      if (!selectedSportId) {
        return input.countries.map((country) => ({ id: country.id, name: country.name }));
      }

      const sportCountryIds = new Set((input.sports.find((sport) => sport.id === selectedSportId)?.countryIds ?? []) as string[]);
      return input.countries
        .filter((country) => sportCountryIds.has(country.id))
        .map((country) => ({ id: country.id, name: country.name }));
    }
    case "host":
      return input.hosts
        .filter((host) => !selectedSportId || host.sportId === selectedSportId)
        .map((host) => ({ id: host.id, name: host.name }));
    case "competition":
      return input.competitions
        .filter((competition) => !selectedSportId || competition.sportId === selectedSportId)
        .map((competition) => ({ id: competition.id, name: competition.name }));
    case "team":
      return input.teams
        .filter((team) => {
          if (selectedSportId && team.sportId !== selectedSportId) {
            return false;
          }

          if (selectedCountryId && team.countryId && team.countryId !== selectedCountryId) {
            return false;
          }

          if (selectedCompetitionId && competitionTeamIds.size > 0 && !competitionTeamIds.has(team.id)) {
            return false;
          }

          return true;
        })
        .map((team) => ({ id: team.id, name: team.name }));
    case "match":
      return input.matches
        .filter((match) => {
          if (selectedCompetitionId && match.competitionId !== selectedCompetitionId) {
            return false;
          }

          if (!selectedCompetitionId && selectedSportId && !competitionIdsForSport.has(match.competitionId)) {
            return false;
          }

          if (selectedTeamId && match.homeTeamId !== selectedTeamId && match.awayTeamId !== selectedTeamId) {
            return false;
          }

          return true;
        })
        .map((match) => ({ id: match.id, name: match.id }));
    default:
      return [];
  }
}

export function sanitizeNewsCategoryRows(
  rows: NewsCategoryFormRow[],
  input: Omit<NewsCategoryFilterInput, "categoryType" | "rows">
): NewsCategoryFormRow[] {
  const selectedSportId = getSelectedCategoryEntityId(rows, "sport");
  const selectedCompetitionId = getSelectedCategoryEntityId(rows, "competition");
  const selectedCountryId = getSelectedCategoryEntityId(rows, "country");
  const selectedTeamId = getSelectedCategoryEntityId(rows, "team");

  const competitionIdsForSport = new Set(
    input.competitions
      .filter((competition) => !selectedSportId || competition.sportId === selectedSportId)
      .map((competition) => competition.id)
  );

  const currentCompetitionTeamIds = new Set(
    selectedCompetitionId && input.competitionTeamIds ? (input.competitionTeamIds[selectedCompetitionId] ?? []) : []
  );

  return rows.map((row) => {
    if (!row.entityId) {
      return row;
    }

    if (row.categoryType === "country" && selectedSportId) {
      const sportCountryIds = new Set((input.sports.find((sport) => sport.id === selectedSportId)?.countryIds ?? []) as string[]);
      if (!sportCountryIds.has(row.entityId)) {
        return { ...row, entityId: "" };
      }
    }

    if (row.categoryType === "competition") {
      const competition = input.competitions.find((entry) => entry.id === row.entityId);
      if (selectedSportId && competition && competition.sportId !== selectedSportId) {
        return { ...row, entityId: "" };
      }
    }

    if (row.categoryType === "team") {
      const team = input.teams.find((entry) => entry.id === row.entityId);
      if (!team) {
        return row;
      }

      if (selectedSportId && team.sportId !== selectedSportId) {
        return { ...row, entityId: "" };
      }

      if (selectedCountryId && team.countryId && team.countryId !== selectedCountryId) {
        return { ...row, entityId: "" };
      }

      if (selectedCompetitionId && currentCompetitionTeamIds.size > 0 && !currentCompetitionTeamIds.has(row.entityId)) {
        return { ...row, entityId: "" };
      }
    }

    if (row.categoryType === "match") {
      const match = input.matches.find((entry) => entry.id === row.entityId);
      if (!match) {
        return row;
      }

      if (selectedCompetitionId && match.competitionId !== selectedCompetitionId) {
        return { ...row, entityId: "" };
      }

      if (!selectedCompetitionId && selectedSportId && !competitionIdsForSport.has(match.competitionId)) {
        return { ...row, entityId: "" };
      }

      if (selectedTeamId && match.homeTeamId !== selectedTeamId && match.awayTeamId !== selectedTeamId) {
        return { ...row, entityId: "" };
      }
    }

    return row;
  });
}
