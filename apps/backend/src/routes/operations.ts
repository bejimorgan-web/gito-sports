import { Router } from "express";

import { protectedRoute } from "../middleware/protected";
import { listOperationalLogs } from "../repositories/operational-log-repository";

export const operationsRouter = Router();

operationsRouter.get("/logs", protectedRoute, (request, response) => {
  const limit = Number(request.query.limit ?? 100);

  response.json({
    data: listOperationalLogs(Number.isFinite(limit) ? limit : 100)
  });
});
