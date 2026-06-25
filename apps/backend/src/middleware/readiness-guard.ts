import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getReadinessStatus, isServerReady } from "../core/server-readiness.js";

export const readinessGuard: RequestHandler = (
  _request: Request,
  response: Response,
  next: NextFunction
) => {
  if (isServerReady()) {
    return next();
  }

  const status = getReadinessStatus();
  const errorPayload = {
    error: "service_initializing",
    message: "The backend is still initializing. Please retry in a moment.",
    readiness: status,
    timestamp: new Date().toISOString()
  };

  response.set("Retry-After", "5");
  response.status(503).json(errorPayload);
};
