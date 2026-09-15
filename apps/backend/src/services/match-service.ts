import { createMatch, deleteMatch, getMatchById, listMatches, updateMatch } from "../repositories/matches-repository.js";

export const MatchService = {
  listMatches,
  getMatchById,
  createMatch,
  updateMatch,
  deleteMatch
};
