import type { Sport } from "@gito/shared";

import { createSport, deleteSport, getSportById, listSports, updateSport } from "../repositories/sports-repository";

export const CatalogService = {
  listSports(): Sport[] {
    return listSports();
  },

  getSport(sportId: string): Sport | undefined {
    return getSportById(sportId);
  },

  createSport(input: Parameters<typeof createSport>[0]): Sport {
    return createSport(input);
  },

  updateSport(sportId: string, input: Parameters<typeof updateSport>[1]): Sport | undefined {
    return updateSport(sportId, input);
  },

  deleteSport(sportId: string, operatorId?: string): boolean {
    return deleteSport(sportId, operatorId);
  }
};
