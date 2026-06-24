import { Router, Request, Response } from "express";
import { MobileConfigRepository } from "../repositories/mobile-config-repository.js";

export const configRouter = Router();

/**
 * GET /config/mobile
 * Returns the current mobile navigation configuration.
 */
configRouter.get("/mobile", (_request: Request, response: Response) => {
  try {
    const config = MobileConfigRepository.getNavigationConfig();
    response.json({
      navigation: config,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("[config] GET /mobile failed:", error);
    response.status(500).json({
      error: "config_fetch_failed",
      message: "Failed to fetch mobile configuration"
    });
  }
});
