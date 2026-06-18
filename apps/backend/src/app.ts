import cors from "cors";
import express from "express";
import helmet from "helmet";

import { workflowErrorHandler } from "./middleware/workflow-error";
import { authRouter } from "./routes/auth";
import path from "node:path";
import fs from "node:fs";

import { healthRouter } from "./routes/health";
import { systemRouter } from "./routes/system";
import { iptvRouter } from "./routes/iptv";
import { liveMatchesRouter } from "./routes/live-matches";
import { matchesRouter } from "./routes/matches";
import { mobileRouter } from "./routes/mobile";
import { operationsRouter } from "./routes/operations";
import { scoresRouter } from "./routes/scores";
import { sportsRouter } from "./routes/sports";
import { countriesRouter } from "./routes/countries";
import { competitionsRouter } from "./routes/competitions";
import { teamsRouter } from "./routes/teams";
import { streamsRouter } from "./routes/streams";
import { uploadsRouter } from "./routes/uploads";
import { eventsRouter } from "./routes/events";
import { env } from "./config/env";

export function createApp() {
  const app = express();

  const uploadDirectory = path.join(path.dirname(env.databasePath), "uploads");
  fs.mkdirSync(uploadDirectory, { recursive: true });

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(
    "/uploads",
    helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }),
    express.static(uploadDirectory)
  );
  app.use("/upload", uploadsRouter);

  app.use("/auth", authRouter);
  app.use("/health", healthRouter);
  app.use("/system", systemRouter);
  app.use("/api/events", eventsRouter);
  app.use("/sports", sportsRouter);
  app.use("/countries", countriesRouter);
  app.use("/competitions", competitionsRouter);
  app.use("/teams", teamsRouter);
  app.use("/matches", matchesRouter);
  app.use("/live-matches", liveMatchesRouter);
  app.use("/mobile", mobileRouter);
  app.use("/operations", operationsRouter);
  app.use("/scores", scoresRouter);
  app.use("/iptv", iptvRouter);
  app.use("/streams", streamsRouter);
  app.use(workflowErrorHandler);

  return app;
}
