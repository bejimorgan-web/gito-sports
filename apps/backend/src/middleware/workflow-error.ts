import type { NextFunction, Request, Response } from "express";

import { WorkflowStateError } from "../services/workflow-state";

export function workflowErrorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  next: NextFunction
) {
  if (error instanceof WorkflowStateError) {
    response.status(error.statusCode).json({
      error: error.code,
      message: error.message
    });
    return;
  }

  if (error instanceof Error) {
    const statusCode = typeof (error as any).statusCode === "number" ? (error as any).statusCode : 500;
    response.status(statusCode).json({
      error: (error as any).code ?? "server_error",
      message: error.message
    });
    return;
  }

  next(error);
}
