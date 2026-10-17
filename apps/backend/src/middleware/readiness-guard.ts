import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getReadinessStatus, hasStartupFailed, isServerReady } from "../core/server-readiness.js";

export const readinessGuard: RequestHandler = (
  request: Request,
  response: Response,
  next: NextFunction
) => {
  // Health and diagnostic endpoints must remain reachable while the rest of
  // the application is gated on successful startup.
  if (request.path === "/health" || request.path.startsWith("/__debug/")) {
    return next();
  }

  if (isServerReady()) {
    return next();
  }

  const status = getReadinessStatus();
  const startupFailed = hasStartupFailed();
  const errorPayload = {
    error: startupFailed ? "service_unavailable" : "service_initializing",
    message: startupFailed
      ? "The backend could not complete required startup initialization."
      : "The backend is still initializing. Please retry in a moment.",
    readiness: status,
    timestamp: new Date().toISOString()
  };

  response.set("Retry-After", "5");
  response.status(503).json(errorPayload);
};
