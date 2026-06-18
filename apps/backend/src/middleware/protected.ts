import type { NextFunction, Request, RequestHandler, Response } from "express";

import { verifyAccessToken } from "../services/jwt";

export interface AuthenticatedRequest extends Request {
  operator?: {
    id: string;
    role: string;
  };
}

export const protectedRoute: RequestHandler = (
  request: Request,
  response: Response,
  next: NextFunction
) => {
  const authenticatedRequest = request as AuthenticatedRequest;
  const authorization = request.header("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;

  if (!token) {
    response.status(401).json({ error: "missing_token" });
    return;
  }

  const payload = verifyAccessToken(token);

  if (!payload) {
    response.status(401).json({ error: "invalid_token" });
    return;
  }

  authenticatedRequest.operator = {
    id: payload.sub,
    role: payload.role
  };

  next();
};
